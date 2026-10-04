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

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NOT_TEXT.has((el as HTMLInputElement).type);
  // closest(), not isContentEditable: the caret sits in a child of the editor root.
  return el.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}

export function isBusy(): boolean {
  return held.size > 0 || isTextEntry(document.activeElement) || getPendingRequests() > 0;
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
  const unsubscribeRequests = subscribeToRequests(listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('focusin', later);
    document.removeEventListener('focusout', later);
    unsubscribeRequests();
  };
}
