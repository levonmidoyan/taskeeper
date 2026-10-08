'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  parseCollapsedSections,
  TASK_SECTIONS_KEY,
  withSectionOpen,
  type CollapsedSections,
  type TaskSectionId,
} from '@/lib/task-sections';

const CHANGE_EVENT = 'taskeeper:task-sections';

// A write that storage refused (private windows, blocked site data) still holds
// for this page's lifetime.
let unsaved: string | null = null;
// getSnapshot must return the same object until the stored string changes.
let cache: { raw: string | null; value: CollapsedSections } | null = null;

function readRaw(): string | null {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(TASK_SECTIONS_KEY);
  } catch {
    return null;
  }
}

function read(): CollapsedSections {
  const raw = readRaw();
  if (cache && cache.raw === raw) return cache.value;
  cache = { raw, value: parseCollapsedSections(raw) };
  return cache.value;
}

function subscribe(onChange: () => void) {
  function onStorage(e: StorageEvent) {
    // Another tab saved: its value wins over anything held in memory here.
    if (e.key === TASK_SECTIONS_KEY) unsaved = null;
    onChange();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Whether one section of the task view is open, remembered per browser across
 * tasks. The server render and first paint show it open, so hydration matches.
 */
export function useTaskSectionOpen(id: TaskSectionId) {
  const open = useSyncExternalStore(subscribe, () => !read()[id], () => true);

  const setOpen = useCallback(
    (next: boolean) => {
      const raw = JSON.stringify(withSectionOpen(read(), id, next));
      try {
        window.localStorage.setItem(TASK_SECTIONS_KEY, raw);
        unsaved = null;
      } catch {
        unsaved = raw;
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [id],
  );

  return [open, setOpen] as const;
}
