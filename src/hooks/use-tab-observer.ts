// AlignUI useTabObserver v0.0.0

'use client';

import * as React from 'react';

interface TabObserverOptions {
  onActiveTabChange?: (index: number, element: HTMLElement) => void;
}

/** Reports the active `[role="tab"]` inside `listRef` whenever the list resizes or mutates. */
export function useTabObserver({ onActiveTabChange }: TabObserverOptions = {}) {
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const onActiveTabChangeRef = React.useRef(onActiveTabChange);

  React.useEffect(() => {
    onActiveTabChangeRef.current = onActiveTabChange;
  }, [onActiveTabChange]);

  const handleUpdate = React.useCallback(() => {
    if (!listRef.current) return;
    const tabs = listRef.current.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs.forEach((el, i) => {
      if (el.getAttribute('data-state') === 'active') onActiveTabChangeRef.current?.(i, el);
    });
  }, []);

  React.useEffect(() => {
    const resizeObserver = new ResizeObserver(handleUpdate);
    const mutationObserver = new MutationObserver(handleUpdate);

    if (listRef.current) {
      resizeObserver.observe(listRef.current);
      mutationObserver.observe(listRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }

    handleUpdate();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [handleUpdate]);

  return { mounted, listRef };
}
