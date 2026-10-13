'use client';

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createDispatcher, type ShortcutHandler } from '@/lib/shortcuts/dispatcher';
import type { ShortcutId } from '@/lib/shortcuts/registry';

const noSubscribe = () => () => {};

export function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** The platform never changes; false on the server so the first paint matches. */
export function useIsMac() {
  return useSyncExternalStore(noSubscribe, isMacPlatform, () => false);
}

type Dispatcher = ReturnType<typeof createDispatcher>;
const ShortcutContext = createContext<Dispatcher | null>(null);

/** Owns the app's one keydown listener; mounted once around the workspace shell. */
export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [dispatcher] = useState(() => createDispatcher({ isMac: isMacPlatform }));

  useEffect(() => {
    window.addEventListener('keydown', dispatcher.handle);
    return () => window.removeEventListener('keydown', dispatcher.handle);
  }, [dispatcher]);

  return <ShortcutContext.Provider value={dispatcher}>{children}</ShortcutContext.Provider>;
}

/**
 * Runs `handler` when the registry's `id` fires. The handler is read at
 * keypress time, so it may close over fresh state without rebinding.
 */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled = true) {
  const dispatcher = useContext(ShortcutContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!dispatcher || !enabled) return;
    return dispatcher.bind(id, (e) => latest.current(e));
  }, [dispatcher, id, enabled]);
}
