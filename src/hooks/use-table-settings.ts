'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_TABLE_SETTINGS,
  parseTableSettings,
  tableSettingsKey,
  type TableSettings,
} from '@/lib/task-table-settings';

const CHANGE_EVENT = 'taskeeper:table-settings';

// Writes that storage refused (private windows, blocked site data) still hold
// for this page's lifetime.
const unsaved = new Map<string, string>();
// getSnapshot must return the same object until the stored string changes.
const parsed = new Map<string, { raw: string | null; value: TableSettings }>();

function readRaw(key: string): string | null {
  if (unsaved.has(key)) return unsaved.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function read(key: string): TableSettings {
  const raw = readRaw(key);
  const hit = parsed.get(key);
  if (hit && hit.raw === raw) return hit.value;
  const value = parseTableSettings(raw);
  parsed.set(key, { raw, value });
  return value;
}

function subscribe(onChange: () => void) {
  function onStorage(e: StorageEvent) {
    // Another tab saved: its value wins over anything held in memory here.
    if (e.key) unsaved.delete(e.key);
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
 * The List table's settings for one project, kept in localStorage. The server
 * render and first paint use the defaults, so hydration always matches.
 */
export function useTableSettings(projectId: string) {
  const key = tableSettingsKey(projectId);
  const settings = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => DEFAULT_TABLE_SETTINGS,
  );

  const update = useCallback(
    (patch: Partial<TableSettings> | null) => {
      const raw = patch ? JSON.stringify({ ...read(key), ...patch }) : null;
      try {
        if (raw === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, raw);
        unsaved.delete(key);
      } catch {
        if (raw === null) unsaved.delete(key);
        else unsaved.set(key, raw);
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return {
    settings,
    /** Merges a change into the stored settings. */
    update: useCallback((patch: Partial<TableSettings>) => update(patch), [update]),
    reset: useCallback(() => update(null), [update]),
  };
}
