import { isInlineType, normalizeContentType } from '@/lib/attachments';

/**
 * Files pasted or dropped into a description or comment are uploaded as task
 * attachments and referenced from the Markdown by their same-origin route.
 * Only that route ever renders as an image: it re-checks the session on every
 * hit, so unlike a remote image it tells no outside host who read the task.
 */

export const ATTACHMENT_PATH = '/api/attachments/';

const ATTACHMENT_SRC = /^\/api\/attachments\/[A-Za-z0-9_-]+$/;

export function attachmentSrc(attachmentId: string): string {
  return `${ATTACHMENT_PATH}${attachmentId}`;
}

export function isAttachmentSrc(src: unknown): src is string {
  return typeof src === 'string' && ATTACHMENT_SRC.test(src);
}

/** Shown in place, not as a link: an image type the browser renders without script (no SVG). */
export function isEmbeddableImage(contentType: string): boolean {
  const type = normalizeContentType(contentType);
  return type.startsWith('image/') && isInlineType(type);
}

/** A file name as link or alt text: brackets and newlines would end the Markdown construct early. */
export function inlineLabel(fileName: string): string {
  return fileName.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || 'file';
}
