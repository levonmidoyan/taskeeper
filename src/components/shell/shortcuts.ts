/** Anything open that owns the keyboard: a dialog, a menu, or a dropdown list such as a Select's. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * Single-key shortcuts must leave the keystroke alone when it belongs to a
 * field, carries a modifier, or lands while a dialog or menu owns the screen.
 */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
    return true;
  }
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}
