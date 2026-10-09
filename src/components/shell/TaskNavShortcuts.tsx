'use client';

import { useShortcut } from '@/lib/shortcuts/provider';
import {
  clickNavItem, collectNavItems, focusedNavId, focusNavItem, navTarget, type NavDirection,
} from '@/lib/shortcuts/nav';

/** Exported for the unit test; the component below is the only caller. */
export function moveNavCursor(dir: NavDirection, e: KeyboardEvent): void | false {
  const current = focusedNavId();
  // Arrows only steer once a task has focus, so they still scroll the page otherwise.
  if (!current && e.key.startsWith('Arrow')) return false;
  const items = collectNavItems();
  if (!items.length) return false;
  const target = current ? navTarget(items, current, dir) : items[0].id;
  if (target) focusNavItem(target);
}

/** j/k/h/l (and arrows) walk the task stops on the page; o opens the focused one. */
export function TaskNavShortcuts() {
  useShortcut('nav.next', (e) => moveNavCursor('next', e));
  useShortcut('nav.prev', (e) => moveNavCursor('prev', e));
  useShortcut('nav.left', (e) => moveNavCursor('left', e));
  useShortcut('nav.right', (e) => moveNavCursor('right', e));
  useShortcut('nav.open', () => {
    const id = focusedNavId();
    // A click, so each view opens the task its own way (dialog or full page).
    if (!id || !clickNavItem(id)) return false;
  });
  return null;
}
