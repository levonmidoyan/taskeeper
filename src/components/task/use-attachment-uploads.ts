'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  enqueue, patchItem, removeItem, retryItem, startable, type UploadItem,
} from '@/lib/upload-queue';
import {
  cancelUploadAction, confirmUploadAction, deleteAttachmentAction, requestUploadAction,
} from '@/server/attachments/actions';

/**
 * One queue per task, kept at module level so the section and the upload
 * modal share it, and closing the modal (or the task dialog) never stops a
 * running upload.
 */
type Store = {
  items: UploadItem[];
  listeners: Set<() => void>;
  xhrs: Map<string, XMLHttpRequest>;
  /** Whether the modal is open; failures toast only when it is not. */
  modalOpen: boolean;
};

const stores = new Map<string, Store>();
const EMPTY: UploadItem[] = [];

export function storeFor(taskId: string): Store {
  let store = stores.get(taskId);
  if (!store) {
    store = { items: [], listeners: new Set(), xhrs: new Map(), modalOpen: false };
    stores.set(taskId, store);
  }
  return store;
}

function update(store: Store, next: UploadItem[]) {
  store.items = next;
  for (const listener of store.listeners) listener();
}

export function setUploadModalOpen(taskId: string, open: boolean) {
  storeFor(taskId).modalOpen = open;
}

function putFile(url: string, file: File, contentType: string, onProgress: (loaded: number) => void, onXhr: (x: XMLHttpRequest) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr(xhr);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.send(file);
  });
}

/**
 * Starts every startable item and drives each to completion, recursing
 * (via a hoisted function declaration, not a self-referencing closure) so one
 * finished slot immediately pulls the next queued item in.
 */
export function pumpStore(store: Store, router: ReturnType<typeof useRouter>, workspaceSlug: string, taskId: string) {
  for (const item of startable(store.items)) void run(item);

  async function run(item: UploadItem) {
    update(store, patchItem(store.items, item.localId, {
      state: 'uploading', loaded: item.uploaded ? item.file.size : 0, error: null,
    }));
    // ✕ removes the item at once, even while an await below is pending; each
    // step checks, so a cancelled upload never goes on to confirm.
    const gone = () => !store.items.some((i) => i.localId === item.localId);
    const fail = (error: string, retryable: boolean) => {
      update(store, patchItem(store.items, item.localId, { state: 'failed', error, retryable }));
      if (!store.modalOpen) toast.error(`${item.file.name}: ${error}`);
    };

    // A rejected action call (network drop, stale deploy, expired session)
    // must not leave the card uploading forever with its slot held.
    try {
      let attachmentId = item.uploaded ? item.attachmentId : null;
      if (!attachmentId) {
        const req = await requestUploadAction(workspaceSlug, {
          taskId, fileName: item.file.name, contentType: item.file.type, size: item.file.size,
        });
        if (!req.ok) {
          if (!gone()) fail(req.error, req.error === 'Upload failed.' || req.error.startsWith('Something went wrong'));
          return pumpStore(store, router, workspaceSlug, taskId);
        }
        if (gone()) {
          void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
          return pumpStore(store, router, workspaceSlug, taskId);
        }
        update(store, patchItem(store.items, item.localId, { attachmentId: req.data.id }));

        try {
          await putFile(
            req.data.url, item.file, req.data.contentType,
            (loaded) => update(store, patchItem(store.items, item.localId, { loaded })),
            (xhr) => store.xhrs.set(item.localId, xhr),
          );
        } catch (error) {
          store.xhrs.delete(item.localId);
          void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
          // A cancel already removed the item; nothing left to mark.
          if (!(error instanceof DOMException && error.name === 'AbortError')) fail('Upload failed.', true);
          return pumpStore(store, router, workspaceSlug, taskId);
        }
        store.xhrs.delete(item.localId);
        if (gone()) {
          void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
          return pumpStore(store, router, workspaceSlug, taskId);
        }
        attachmentId = req.data.id;
        update(store, patchItem(store.items, item.localId, { uploaded: true }));
      }

      // Past this point a cancel would race the confirm, so ✕ is hidden and ignored.
      update(store, patchItem(store.items, item.localId, { confirming: true }));
      const done = await confirmUploadAction(workspaceSlug, { attachmentId });
      update(store, patchItem(store.items, item.localId, { confirming: false }));
      if (!done.ok) {
        // A definite answer (the object is missing or the row is gone) means
        // the next retry starts over; a generic failure may have confirmed.
        if (!done.error.startsWith('Something went wrong')) {
          update(store, patchItem(store.items, item.localId, { uploaded: false, attachmentId: null }));
        }
        fail(done.error, true);
      } else {
        update(store, patchItem(store.items, item.localId, { state: 'done', loaded: item.file.size }));
        router.refresh();
      }
    } catch {
      store.xhrs.delete(item.localId);
      update(store, patchItem(store.items, item.localId, { confirming: false }));
      if (!gone()) fail('Upload failed.', true);
    }
    pumpStore(store, router, workspaceSlug, taskId);
  }
}

export function useAttachmentUploads(workspaceSlug: string, taskId: string) {
  const router = useRouter();
  const store = storeFor(taskId);

  const items = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.items,
    () => EMPTY,
  );

  const pump = useCallback(() => {
    pumpStore(store, router, workspaceSlug, taskId);
  }, [router, store, taskId, workspaceSlug]);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    update(store, enqueue(store.items, files, () => crypto.randomUUID()));
    pump();
  }, [pump, store]);

  const cancel = useCallback((localId: string) => {
    if (store.items.find((i) => i.localId === localId)?.confirming) return;
    store.xhrs.get(localId)?.abort();
    update(store, removeItem(store.items, localId));
    pump();
  }, [pump, store]);

  const retry = useCallback((localId: string) => {
    update(store, retryItem(store.items, localId));
    pump();
  }, [pump, store]);

  const remove = useCallback(async (localId: string) => {
    const item = store.items.find((i) => i.localId === localId);
    if (item?.attachmentId) {
      try {
        const result = await deleteAttachmentAction(workspaceSlug, { attachmentId: item.attachmentId });
        // Already deleted from the section: the item is stale, so drop it.
        if (!result.ok && result.error !== 'Attachment not found.') {
          toast.error(result.error);
          return;
        }
      } catch {
        toast.error('Something went wrong. Please try again.');
        return;
      }
      router.refresh();
    }
    update(store, removeItem(store.items, localId));
  }, [router, store, workspaceSlug]);

  return { items, add, cancel, retry, remove };
}
