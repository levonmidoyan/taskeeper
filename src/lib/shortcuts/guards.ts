/** Anything open that owns the keyboard: a dialog or confirm, a menu, or a dropdown list such as a Select's. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The task detail dialog or task page: a dialog that still lets task shortcuts through. */
export const DETAIL_SELECTOR = '[data-shortcut-scope="detail"]';

/** A board card mid keyboard-drag: dnd-kit owns the arrows until it drops. */
const DRAGGING_SELECTOR = '[aria-roledescription="sortable"][aria-pressed="true"]';

export function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export type ActiveScope = 'none' | 'nav' | 'detail';

/**
 * Which shortcuts a keystroke may reach. Fields, handled events, drags and any
 * overlay other than the task detail (a picker, menu, confirm, the palette)
 * keep the keystroke; Alt/Ctrl/Meta are checked per key in matchStep.
 */
export function activeScope(e: KeyboardEvent, doc: Document = document): ActiveScope {
  if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return 'none';
  // A focused Select trigger picks an option by its first letter even while closed.
  if (e.target instanceof Element && e.target.closest('[role="combobox"]')) return 'none';
  if (doc.querySelector(DRAGGING_SELECTOR)) return 'none';
  for (const el of doc.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!el.matches(DETAIL_SELECTOR)) return 'none';
  }
  return doc.querySelector(DETAIL_SELECTOR) ? 'detail' : 'nav';
}
