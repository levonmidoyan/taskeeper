import { getPendingRequests, subscribeToRequests } from '@/lib/request-tracker';

/**
 * Whether a live refresh would get in the user's way right now: mid-drag,
 * typing, or waiting on one of their own requests. LiveRefresh holds a pending
 * refresh until this turns false.
 */

const held = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called on drag start; `key` names the drag surface. */
export function markBusy(key: string): void {
  held.add(key);
  emit();
}

export function releaseBusy(key: string): void {
  if (held.delete(key)) emit();
}

// Inputs that take a click, not typing: focus left on one must not hold refreshes.
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

/** Typing, or a focused <select> (arrow keys and type-ahead change its value). */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !NOT_TEXT.has((el as HTMLInputElement).type);
  // closest(), not isContentEditable: the caret sits in a child of the editor root.
  return el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]') !== null;
}

// A request's response arrives before the page it carries is on screen, and
// with it the version the layout reports. Held after my last request settles
// until that page renders (endSettle), so my own edit does not look like a
// teammate's. The timer is only a ceiling, for requests that render no new
// version.
export const REQUEST_SETTLE_MS = 3000;
let settlingUntil = 0;

/** The page my request carried is on screen: stop holding for it. */
export function endSettle(): void {
  if (Date.now() >= settlingUntil) return;
  settlingUntil = 0;
  emit();
}

export function isBusy(): boolean {
  return (
    held.size > 0 ||
    isTextEntry(document.activeElement) ||
    getPendingRequests() > 0 ||
    Date.now() < settlingUntil
  );
}

/** Fires whenever isBusy() may have changed. */
export function subscribeBusy(listener: () => void): () => void {
  // focusout fires before focus lands anywhere new, so look on the next task.
  const later = () => {
    setTimeout(listener, 0);
  };
  listeners.add(listener);
  document.addEventListener('focusin', later);
  document.addEventListener('focusout', later);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribeRequests = subscribeToRequests(() => {
    if (getPendingRequests() === 0) {
      settlingUntil = Date.now() + REQUEST_SETTLE_MS;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(listener, REQUEST_SETTLE_MS);
    }
    listener();
  });
  return () => {
    listeners.delete(listener);
    document.removeEventListener('focusin', later);
    document.removeEventListener('focusout', later);
    clearTimeout(settleTimer);
    unsubscribeRequests();
  };
}
