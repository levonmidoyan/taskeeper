/** Fired on an element marked `data-local-escape` when a dialog hands it Escape. */
export const LOCAL_ESCAPE_EVENT = 'taskeeper:local-escape';

/**
 * Lets Escape inside an element marked `data-local-escape` (an edit in progress)
 * end that edit instead of closing the surrounding dialog. Call it from the
 * dialog's onEscapeKeyDown and preventDefault when it returns true: Radix sees
 * Escape first, on the document, so the element hears of it by this event.
 */
export function handOffEscape(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const owner = target.closest('[data-local-escape]');
  if (!owner) return false;
  owner.dispatchEvent(new Event(LOCAL_ESCAPE_EVENT));
  return true;
}
