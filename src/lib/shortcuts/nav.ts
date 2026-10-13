import { DETAIL_SELECTOR } from '@/lib/shortcuts/guards';

export const NAV_ATTR = 'data-task-nav';
export const NAV_COL_ATTR = 'data-nav-col';

/** A task the keyboard can land on; `col` is its board column, null in a list. */
export type NavItem = { id: string; col: string | null; top: number; bottom: number };
export type NavDirection = 'next' | 'prev' | 'left' | 'right';

const centre = (i: NavItem) => (i.top + i.bottom) / 2;

/**
 * The task the cursor moves to, or null to stay put. Up/down stays in the
 * current column (the whole list when there are none); left/right skips empty
 * columns and lands on the card level with the current one.
 */
export function navTarget(items: NavItem[], currentId: string, dir: NavDirection): string | null {
  const current = items.find((i) => i.id === currentId);
  if (!current) return null;

  if (dir === 'next' || dir === 'prev') {
    const peers = items.filter((i) => i.col === current.col);
    const at = peers.indexOf(current);
    return peers[dir === 'next' ? at + 1 : at - 1]?.id ?? null;
  }

  if (current.col === null) return null;
  const cols = [...new Set(items.map((i) => i.col).filter((c): c is string => c !== null))];
  const step = dir === 'right' ? 1 : -1;
  for (let c = cols.indexOf(current.col) + step; c >= 0 && c < cols.length; c += step) {
    const column = items.filter((i) => i.col === cols[c]);
    if (!column.length) continue;
    const y = centre(current);
    return column.reduce((best, i) => (Math.abs(centre(i) - y) < Math.abs(centre(best) - y) ? i : best)).id;
  }
  return null;
}

/** Every task stop on the page behind any open task, in DOM order. */
export function collectNavItems(doc: Document = document): NavItem[] {
  return [...doc.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)]
    .filter((el) => !el.closest(DETAIL_SELECTOR))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute(NAV_ATTR)!, col: el.getAttribute(NAV_COL_ATTR), top: r.top, bottom: r.bottom };
    });
}

export function focusedNavId(doc: Document = document): string | null {
  return doc.activeElement?.closest(`[${NAV_ATTR}]`)?.getAttribute(NAV_ATTR) ?? null;
}

function navElement(id: string, doc: Document) {
  return doc.querySelector<HTMLElement>(`[${NAV_ATTR}="${CSS.escape(id)}"]`);
}

/** Focuses a task's stop and scrolls it just into view. */
export function focusNavItem(id: string, doc: Document = document): boolean {
  const el = navElement(id, doc);
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

export function clickNavItem(id: string, doc: Document = document): boolean {
  const el = navElement(id, doc);
  el?.click();
  return el !== null;
}
