import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestUploadAction = vi.fn();
const confirmUploadAction = vi.fn();
const cancelUploadAction = vi.fn();
const deleteAttachmentAction = vi.fn();
vi.mock('@/server/attachments/actions', () => ({
  requestUploadAction: (...a: unknown[]) => requestUploadAction(...a),
  confirmUploadAction: (...a: unknown[]) => confirmUploadAction(...a),
  cancelUploadAction: (...a: unknown[]) => cancelUploadAction(...a),
  deleteAttachmentAction: (...a: unknown[]) => deleteAttachmentAction(...a),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { enqueue, retryItem } from '@/lib/upload-queue';
import { discardItem, pumpStore, storeFor } from '@/components/task/use-attachment-uploads';

const router = { refresh: vi.fn() } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

let n = 0;
function queue(taskId: string, count: number) {
  const store = storeFor(taskId);
  const files = Array.from({ length: count }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
  store.items = enqueue([], files, () => `id-${n++}`);
  return store;
}

beforeEach(() => {
  requestUploadAction.mockReset();
  confirmUploadAction.mockReset();
  cancelUploadAction.mockReset();
  deleteAttachmentAction.mockReset();
  vi.unstubAllGlobals();
});

describe('pumpStore when an action call rejects', () => {
  it('fails the item as retryable instead of leaving it uploading', async () => {
    requestUploadAction.mockRejectedValue(new Error('Failed to fetch'));
    const store = queue('t-reject', 1);

    pumpStore(store, router, 'ws', 't-reject');
    await flush();

    expect(store.items[0]).toMatchObject({ state: 'failed', retryable: true, error: 'Upload failed.' });
  });

  it('frees the slot so queued items keep going', async () => {
    requestUploadAction.mockRejectedValue(new Error('Failed to fetch'));
    const store = queue('t-slots', 5);

    pumpStore(store, router, 'ws', 't-slots');
    await flush();
    await flush();

    expect(store.items.every((i) => i.state === 'failed')).toBe(true);
    expect(requestUploadAction).toHaveBeenCalledTimes(5);
  });
});

/** A PUT that always lands: node has no XMLHttpRequest. */
class OkXhr {
  status = 0;
  upload: { onprogress?: (e: { loaded: number }) => void } = {};
  onload?: () => void;
  open() {}
  setRequestHeader() {}
  abort() {}
  send() {
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

describe('pumpStore when the confirm call fails', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', OkXhr);
    requestUploadAction.mockResolvedValue({
      ok: true, data: { id: 'att-1', url: 'https://storage.test/put', contentType: 'text/plain' },
    });
  });

  async function settle() {
    for (let i = 0; i < 5; i++) await flush();
  }

  // The server may have confirmed before the response was lost; uploading again
  // would add the file twice.
  it('retries only the confirm once the bytes are up', async () => {
    confirmUploadAction
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, data: { id: 'att-1' } });
    const store = queue('t-confirm', 1);

    pumpStore(store, router, 'ws', 't-confirm');
    await settle();
    expect(store.items[0]).toMatchObject({ state: 'failed', retryable: true, uploaded: true, attachmentId: 'att-1' });

    store.items = retryItem(store.items, store.items[0].localId);
    pumpStore(store, router, 'ws', 't-confirm');
    await settle();

    expect(store.items[0].state).toBe('done');
    expect(requestUploadAction).toHaveBeenCalledTimes(1);
    expect(confirmUploadAction).toHaveBeenCalledTimes(2);
    expect(confirmUploadAction).toHaveBeenLastCalledWith('ws', { attachmentId: 'att-1' });
  });

  it('uploads again when the server says the upload did not finish', async () => {
    confirmUploadAction
      .mockResolvedValueOnce({ ok: false, error: 'Upload did not finish.' })
      .mockResolvedValueOnce({ ok: true, data: { id: 'att-1' } });
    const store = queue('t-unfinished', 1);

    pumpStore(store, router, 'ws', 't-unfinished');
    await settle();
    expect(store.items[0]).toMatchObject({ state: 'failed', uploaded: false, attachmentId: null });

    store.items = retryItem(store.items, store.items[0].localId);
    pumpStore(store, router, 'ws', 't-unfinished');
    await settle();

    expect(store.items[0].state).toBe('done');
    expect(requestUploadAction).toHaveBeenCalledTimes(2);
  });
});

describe('discardItem', () => {
  function failedAfterUpload(taskId: string) {
    const store = queue(taskId, 1);
    store.items = [{ ...store.items[0], state: 'failed', error: 'Upload failed.', retryable: true, uploaded: true, attachmentId: 'att-1' }];
    return store;
  }

  it('cancels the pending upload on the server before dropping the card', async () => {
    cancelUploadAction.mockResolvedValue({ ok: true, data: null });
    const store = failedAfterUpload('t-discard-pending');

    expect(await discardItem(store, router, 'ws', store.items[0].localId)).toBe(true);

    expect(cancelUploadAction).toHaveBeenCalledWith('ws', { attachmentId: 'att-1' });
    expect(deleteAttachmentAction).not.toHaveBeenCalled();
    expect(store.items).toHaveLength(0);
  });

  // The confirm whose response was lost did attach the file; dismissing must
  // still take it off the task.
  it('deletes the attachment when the failed confirm went through', async () => {
    cancelUploadAction.mockResolvedValue({ ok: false, error: 'Attachment not found.' });
    deleteAttachmentAction.mockResolvedValue({ ok: true, data: null });
    const store = failedAfterUpload('t-discard-ready');

    expect(await discardItem(store, router, 'ws', store.items[0].localId)).toBe(true);

    expect(deleteAttachmentAction).toHaveBeenCalledWith('ws', { attachmentId: 'att-1' });
    expect(store.items).toHaveLength(0);
  });

  it('keeps the card when the server cleanup fails', async () => {
    cancelUploadAction.mockRejectedValue(new Error('Failed to fetch'));
    const store = failedAfterUpload('t-discard-error');

    expect(await discardItem(store, router, 'ws', store.items[0].localId)).toBe(false);

    expect(store.items).toHaveLength(1);
  });

  it('drops an item with nothing on the server without calling it', async () => {
    const store = queue('t-discard-local', 1);
    store.items = [{ ...store.items[0], state: 'failed', error: 'Files can be up to 25 MB.' }];

    expect(await discardItem(store, router, 'ws', store.items[0].localId)).toBe(true);

    expect(cancelUploadAction).not.toHaveBeenCalled();
    expect(store.items).toHaveLength(0);
  });
});
