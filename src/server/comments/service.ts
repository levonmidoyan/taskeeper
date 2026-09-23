import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { comment, db, task } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

const bodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(10_000, 'That comment is too long.');

/** Loads a comment only if it belongs to this workspace. */
async function loadOwnedComment(ctx: WorkspaceContext, commentId: string) {
  const [row] = await db
    .select({ id: comment.id, authorId: comment.authorId, taskId: comment.taskId })
    .from(comment)
    .where(and(eq(comment.id, commentId), eq(comment.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function createComment(
  ctx: WorkspaceContext,
  input: { taskId: string; body: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = z
      .object({ taskId: z.string().min(1), body: bodySchema })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const id = newId();
    await db.insert(comment).values({
      id,
      workspaceId: ctx.workspaceId,
      taskId: parsed.data.taskId,
      // From the context, never the input.
      authorId: ctx.userId,
      body: parsed.data.body,
    });

    return ok({ id });
  });
}

export async function updateComment(
  ctx: WorkspaceContext,
  input: { commentId: string; body: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z
      .object({ commentId: z.string().min(1), body: bodySchema })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const owned = await loadOwnedComment(ctx, parsed.data.commentId);
    if (!owned) return err('Comment not found.');
    // Editing is author-only, admins included: an edited comment still carries
    // its author's name, so someone else's words must not change under it.
    if (owned.authorId !== ctx.userId) return err('You can only edit your own comments.');

    await db
      .update(comment)
      .set({ body: parsed.data.body, editedAt: new Date() })
      .where(eq(comment.id, parsed.data.commentId));

    return ok(null);
  });
}

export async function deleteComment(
  ctx: WorkspaceContext,
  input: { commentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const owned = await loadOwnedComment(ctx, input.commentId);
    if (!owned) return err('Comment not found.');

    // Unlike editing, deletion is also a moderation tool.
    const canModerate = ctx.role === 'owner' || ctx.role === 'admin';
    if (owned.authorId !== ctx.userId && !canModerate) {
      return err('You can only delete your own comments.');
    }

    await db.delete(comment).where(eq(comment.id, input.commentId));

    return ok(null);
  });
}
