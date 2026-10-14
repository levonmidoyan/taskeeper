import { and, eq } from 'drizzle-orm';
import { attachment, db, member } from '@/db';
import { contentDisposition, isInlineType, previewKind } from '@/lib/attachments';
import { presignGet, readObjectHead, storageEnabled } from '@/lib/storage';

/**
 * A presigned GET for a ready attachment the user can see, else null. Resolved
 * by membership of the attachment's own workspace in the same query, so a
 * user removed from the workspace loses access at once, and "not yours" looks
 * exactly like "does not exist".
 */
export async function resolveDownload(
  userId: string,
  attachmentId: string,
  opts: { download: boolean },
): Promise<string | null> {
  if (!storageEnabled()) return null;

  const [row] = await db
    .select({ key: attachment.key, fileName: attachment.fileName, contentType: attachment.contentType })
    .from(attachment)
    .innerJoin(member, and(eq(member.organizationId, attachment.workspaceId), eq(member.userId, userId)))
    .where(and(eq(attachment.id, attachmentId), eq(attachment.status, 'ready')))
    .limit(1);
  if (!row) return null;

  const inline = !opts.download && isInlineType(row.contentType);
  return presignGet({
    key: row.key,
    // Anything not shown inline is served as opaque bytes, so the browser
    // never sniffs and renders it.
    contentType: inline ? row.contentType : 'application/octet-stream',
    disposition: contentDisposition(row.fileName, inline),
  });
}

/** How much of a text file the preview shows. */
export const TEXT_PREVIEW_BYTES = 256 * 1024;

export type TextPreview =
  | { status: 'ok'; text: string; truncated: boolean }
  | { status: 'unsupported' }
  | { status: 'missing' };

/**
 * The start of a text attachment, read through the server so the bucket needs
 * no CORS for GET. Same visibility rule as resolveDownload.
 */
export async function readTextPreview(userId: string, attachmentId: string): Promise<TextPreview> {
  if (!storageEnabled()) return { status: 'missing' };

  const [row] = await db
    .select({ key: attachment.key, fileName: attachment.fileName, contentType: attachment.contentType, size: attachment.size })
    .from(attachment)
    .innerJoin(member, and(eq(member.organizationId, attachment.workspaceId), eq(member.userId, userId)))
    .where(and(eq(attachment.id, attachmentId), eq(attachment.status, 'ready')))
    .limit(1);
  if (!row) return { status: 'missing' };
  if (previewKind(row.fileName, row.contentType) !== 'text') return { status: 'unsupported' };

  const bytes = await readObjectHead(row.key, TEXT_PREVIEW_BYTES);
  // A cut can land inside a multi-byte character; the decoder swaps it for U+FFFD.
  return { status: 'ok', text: new TextDecoder().decode(bytes), truncated: row.size > TEXT_PREVIEW_BYTES };
}
