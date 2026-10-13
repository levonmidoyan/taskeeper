import { matchStep, parseBinding, type KeyStep } from '@/lib/shortcuts/keys';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/registry';
import { activeScope } from '@/lib/shortcuts/guards';

/** Return false to leave the keystroke alone (no preventDefault), e.g. an arrow with nothing focused. */
export type ShortcutHandler = (e: KeyboardEvent) => void | false;

const PARSED = SHORTCUTS.map((def) => ({ def, bindings: def.keys.map(parseBinding) }));

/**
 * One keydown handler for the whole app. Components bind handlers to registry
 * ids; the latest binding of an id wins, so a nested view can take a key over
 * and give it back on unmount.
 */
export function createDispatcher({
  isMac, now = () => Date.now(), chordMs = 1000,
}: { isMac: () => boolean; now?: () => number; chordMs?: number }) {
  const handlers = new Map<ShortcutId, ShortcutHandler[]>();
  let pending: { step: KeyStep; at: number } | null = null;

  function bind(id: ShortcutId, handler: ShortcutHandler) {
    const stack = handlers.get(id) ?? [];
    stack.push(handler);
    handlers.set(id, stack);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }

  function live(scope: 'nav' | 'detail') {
    return PARSED.filter(({ def }) =>
      (def.scope === 'global' || def.scope === scope) && (handlers.get(def.id)?.length ?? 0) > 0);
  }

  function run(id: ShortcutId, e: KeyboardEvent) {
    const stack = handlers.get(id)!;
    if (stack[stack.length - 1](e) !== false) e.preventDefault();
  }

  function handle(e: KeyboardEvent) {
    const scope = activeScope(e);
    if (scope === 'none') {
      pending = null;
      return;
    }
    const mac = isMac();
    const candidates = live(scope);

    if (pending) {
      const first = pending;
      pending = null;
      // The second key of a chord never falls through to a single-key shortcut.
      if (now() - first.at <= chordMs) {
        for (const { def, bindings } of candidates) {
          if (bindings.some((b) => b.length === 2 && b[0].key === first.step.key && matchStep(b[1], e, mac))) {
            run(def.id, e);
            return;
          }
        }
        return;
      }
    }

    for (const { bindings } of candidates) {
      const chord = bindings.find((b) => b.length === 2 && matchStep(b[0], e, mac));
      if (chord) {
        pending = { step: chord[0], at: now() };
        e.preventDefault();
        return;
      }
    }

    for (const { def, bindings } of candidates) {
      if (bindings.some((b) => b.length === 1 && matchStep(b[0], e, mac))) {
        run(def.id, e);
        return;
      }
    }
  }

  return { bind, handle };
}
