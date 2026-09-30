import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';

/**
 * The upload queue as plain data, so its rules are tested without a browser.
 * The hook in components/task/use-attachment-uploads.ts owns the side effects.
 */

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export type UploadItem = {
  localId: string;
  file: File;
  state: UploadState;
  loaded: number;
  error: string | null;
  /** False for failures a retry cannot fix, such as a file over the limit. */
  retryable: boolean;
  attachmentId: string | null;
  /** Bytes are up and the server is confirming; too late to cancel. */
  confirming: boolean;
  /**
   * The bytes are in storage under attachmentId, so a retry only confirms. A
   * confirm whose response was lost may already have succeeded; uploading again
   * would add the file twice.
   */
  uploaded: boolean;
};

export const MAX_PARALLEL = 3;

export function enqueue(items: UploadItem[], files: File[], makeId: () => string): UploadItem[] {
  const added = files.map((file): UploadItem => {
    const tooBig = file.size < 1 || file.size > MAX_ATTACHMENT_BYTES;
    return {
      localId: makeId(),
      file,
      state: tooBig ? 'failed' : 'queued',
      loaded: 0,
      error: tooBig ? 'Files can be up to 25 MB.' : null,
      retryable: false,
      attachmentId: null,
      confirming: false,
      uploaded: false,
    };
  });
  return [...items, ...added];
}

export function startable(items: UploadItem[]): UploadItem[] {
  const running = items.filter((i) => i.state === 'uploading').length;
  return items.filter((i) => i.state === 'queued').slice(0, Math.max(0, MAX_PARALLEL - running));
}

export function patchItem(items: UploadItem[], localId: string, patch: Partial<UploadItem>): UploadItem[] {
  return items.map((i) => (i.localId === localId ? { ...i, ...patch } : i));
}

export function removeItem(items: UploadItem[], localId: string): UploadItem[] {
  return items.filter((i) => i.localId !== localId);
}

/** Back in the queue; an item whose bytes are already up keeps its attachment. */
export function retryItem(items: UploadItem[], localId: string): UploadItem[] {
  return items.map((i) => (
    i.localId === localId
      ? {
        ...i, state: 'queued', error: null, confirming: false,
        attachmentId: i.uploaded ? i.attachmentId : null,
        loaded: i.uploaded ? i.file.size : 0,
      }
      : i
  ));
}
