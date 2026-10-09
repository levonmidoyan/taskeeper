/** One keystroke of a shortcut. `mod` is Meta on Mac, Control elsewhere. */
export type KeyStep = { key: string; mod: boolean };

/** 'j', 'ArrowDown', '?', 'Mod+k', or a two-step chord 'g b'. */
export function parseBinding(spec: string): KeyStep[] {
  return spec.split(' ').map((part) =>
    part.startsWith('Mod+') ? { key: part.slice(4), mod: true } : { key: part, mod: false },
  );
}

/**
 * Shift is never checked, so '?' and '#' match as typed, while 'J' (Shift+j)
 * is simply a different key from 'j'.
 */
export function matchStep(
  step: KeyStep,
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  isMac: boolean,
): boolean {
  // Autofill fires keydown events with no `key`.
  if (!e.key || e.altKey) return false;
  const modHeld = isMac ? e.metaKey : e.ctrlKey;
  const otherHeld = isMac ? e.ctrlKey : e.metaKey;
  if (otherHeld || modHeld !== step.mod) return false;
  return step.mod ? e.key.toLowerCase() === step.key : e.key === step.key;
}

const LABELS: Record<string, string> = {
  ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Delete: 'Del', Enter: 'Enter',
};

/** Key caps to draw, one array per step: 'Mod+k' → [['⌘', 'K']]. */
export function formatBinding(spec: string, isMac: boolean): string[][] {
  return parseBinding(spec).map(({ key, mod }) => {
    const cap = LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    return mod ? [isMac ? '⌘' : 'Ctrl', cap] : [cap];
  });
}
