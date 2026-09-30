import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestUploadAction = vi.fn();
const confirmUploadAction = vi.fn();
vi.mock('@/server/attachments/actions', () => ({
  requestUploadAction: (...a: unknown[]) => requestUploadAction(...a),
  confirmUploadAction: (...a: unknown[]) => confirmUploadAction(...a),
  cancelUploadAction: vi.fn(),
  deleteAttachmentAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { enqueue } from '@/lib/upload-queue';
import { pumpStore, storeFor } from '@/components/task/use-attachment-uploads';

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
