import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { attachment, db, project, task } from '@/db';
import {
  MAX_ATTACHMENT_BYTES, attachmentKey, normalizeContentType, sanitizeFileName,
} from '@/lib/attachments';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { deleteObject, headObject, presignPut, storageEnabled } from '@/lib/storage';
import { recordActivity } from '@/server/activity/service';
import { emitChange } from '@/server/changes/service';
import { getAttachmentView, type AttachmentView } from './queries';

const NOT_SET_UP = 'Attachments are not set up.';
const UNFINISHED = 'Upload did not finish.';
const NOT_FOUND = 'Attachment not found.';

/** Best-effort: a failed delete leaves an orphan for the sweep, never an error. */
async function dropObject(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (error) {
    console.error('[attachments] could not delete object', key, error);
  }
}

export async function requestUpload(
  ctx: WorkspaceContext,
  input: { taskId: string; fileName: string; contentType: string; size: number },
): Promise<Result<{ id: string; url: string; contentType: string }>> {
  return withAction(async () => {
    if (!storageEnabled()) return err(NOT_SET_UP);

    const parsed = z
      .object({
        taskId: z.string().min(1),
        fileName: z.string(),
        contentType: z.string(),
        size: z.number().int(),
      })
      .safeParse(input);
    if (!parsed.success) return err('Upload failed.');
    const { taskId, size } = parsed.data;
    if (size < 1 || size > MAX_ATTACHMENT_BYTES) return err('Files can be up to 25 MB.');

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const id = newId();
    const key = attachmentKey(ctx.workspaceId, taskId, id);
    const contentType = normalizeContentType(parsed.data.contentType);
    await db.insert(attachment).values({
      id,
      workspaceId: ctx.workspaceId,
      taskId,
      // From the context, never the input.
      uploaderId: ctx.userId,
      key,
      fileName: sanitizeFileName(parsed.data.fileName),
      contentType,
      size,
    });

    const url = await presignPut({ key, contentType, size });
    return ok({ id, url, contentType });
  });
}

/** The caller's own pending row in this workspace. */
async function loadOwnPending(ctx: WorkspaceContext, attachmentId: string) {
  const [row] = await db
    .select()
    .from(attachment)
    .where(and(
      eq(attachment.id, attachmentId),
      eq(attachment.workspaceId, ctx.workspaceId),
      eq(attachment.uploaderId, ctx.userId),
      eq(attachment.status, 'pending'),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * A repeat confirm — the first one's response was lost, or two raced — answers
 * with the attachment the uploader already has, so the client never uploads the
 * file again. Nothing is written: the first confirm recorded the activity.
 */
async function alreadyConfirmed(ctx: WorkspaceContext, attachmentId: string): Promise<Result<AttachmentView>> {
  const [ready] = await db
    .select({ id: attachment.id })
    .from(attachment)
    .where(and(
      eq(attachment.id, attachmentId),
      eq(attachment.workspaceId, ctx.workspaceId),
      eq(attachment.uploaderId, ctx.userId),
      eq(attachment.status, 'ready'),
    ))
    .limit(1);
  const view = ready ? await getAttachmentView(ctx, ready.id) : null;
  return view ? ok(view) : err(UNFINISHED);
}

export async function confirmUpload(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<AttachmentView>> {
  return withAction(async () => {
    const row = await loadOwnPending(ctx, input.attachmentId);
    if (!row) return alreadyConfirmed(ctx, input.attachmentId);

    const head = await headObject(row.key);
    if (!head) return err(UNFINISHED);
    if (head.size !== row.size) {
      await db.delete(attachment).where(eq(attachment.id, row.id));
      await dropObject(row.key);
      return err(UNFINISHED);
    }

    // Guarded on 'pending' so a concurrent confirm or delete wins cleanly and
    // the activity is written once.
    const confirmed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(attachment)
        .set({ status: 'ready' })
        .where(and(eq(attachment.id, row.id), eq(attachment.status, 'pending')))
        .returning({ id: attachment.id });
      if (!updated.length) return false;
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_added', to: row.fileName }, tx);
      await emitChange(ctx, {}, tx);
      return true;
    });
    if (!confirmed) return alreadyConfirmed(ctx, row.id);

    const view = await getAttachmentView(ctx, row.id);
    return view ? ok(view) : err(UNFINISHED);
  });
}

export async function cancelUpload(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const row = await loadOwnPending(ctx, input.attachmentId);
    if (!row) return err(NOT_FOUND);

    await db.delete(attachment).where(eq(attachment.id, row.id));
    await dropObject(row.key);
    return ok(null);
  });
}

export async function deleteAttachment(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const [row] = await db
      .select()
      .from(attachment)
      .where(and(
        eq(attachment.id, input.attachmentId),
        eq(attachment.workspaceId, ctx.workspaceId),
        eq(attachment.status, 'ready'),
      ))
      .limit(1);
    if (!row) return err(NOT_FOUND);

    // Same rule as comments: deletion is also a moderation tool.
    const canModerate = ctx.role === 'owner' || ctx.role === 'admin';
    if (row.uploaderId !== ctx.userId && !canModerate) {
      return err('You can only delete your own attachments.');
    }

    // Only the delete that removed the row records it, so a concurrent delete
    // writes the activity once.
    const deleted = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(attachment)
        .where(eq(attachment.id, row.id))
        .returning({ id: attachment.id });
      if (!removed.length) return false;
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_removed', from: row.fileName }, tx);
      await emitChange(ctx, {}, tx);
      return true;
    });
    if (!deleted) return err(NOT_FOUND);
    // After commit: a rolled-back delete must not have lost the file.
    await dropObject(row.key);
    return ok(null);
  });
}
