import { and, desc, eq, type SQL } from 'drizzle-orm';
import { attachment, db, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export type AttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: Date;
  /** Null once the uploader has deleted their account. */
  uploaderId: string | null;
  uploaderName: string;
  uploaderImage: string | null;
};

/** Shown in place of a name whose account has since been deleted. */
const DELETED_USER = 'Deleted user';

async function selectViews(where: SQL | undefined): Promise<AttachmentView[]> {
  const rows = await db
    .select({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      uploaderId: attachment.uploaderId,
      uploaderName: user.name,
      uploaderImage: user.image,
    })
    .from(attachment)
    .leftJoin(user, eq(user.id, attachment.uploaderId))
    .where(where)
    .orderBy(desc(attachment.createdAt), desc(attachment.id));
  return rows.map((r) => ({ ...r, uploaderName: r.uploaderName ?? DELETED_USER }));
}

/** Ready attachments only: a pending row is an upload still in flight or abandoned. */
export function listTaskAttachments(ctx: WorkspaceContext, taskId: string): Promise<AttachmentView[]> {
  return selectViews(and(
    eq(attachment.taskId, taskId),
    eq(attachment.workspaceId, ctx.workspaceId),
    eq(attachment.status, 'ready'),
  ));
}

export async function getAttachmentView(ctx: WorkspaceContext, attachmentId: string): Promise<AttachmentView | null> {
  const [view] = await selectViews(and(
    eq(attachment.id, attachmentId),
    eq(attachment.workspaceId, ctx.workspaceId),
    eq(attachment.status, 'ready'),
  ));
  return view ?? null;
}
