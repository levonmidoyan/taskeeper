import { describe, expect, it } from 'vitest';
import { parseBinding } from '@/lib/shortcuts/keys';
import { SHORTCUT_GROUPS, SHORTCUTS } from '@/lib/shortcuts/registry';

describe('SHORTCUTS', () => {
  it('has unique ids and known groups', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORTCUTS.every((s) => SHORTCUT_GROUPS.includes(s.group))).toBe(true);
  });

  it('never binds the same key twice in scopes that are live together', () => {
    // nav and detail are never live at once; global is live with both.
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        for (const scope of s.scope === 'global' ? ['nav', 'detail'] : [s.scope]) {
          const slot = `${scope}:${k}`;
          expect(seen.get(slot), `${k} in ${scope}: ${s.id} vs ${seen.get(slot)}`).toBeUndefined();
          seen.set(slot, s.id);
        }
      }
    }
  });

  it('only starts chords with g, and g is never a single-key shortcut', () => {
    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        const steps = parseBinding(k);
        if (steps.length === 2) expect(steps[0].key).toBe('g');
        else expect(steps[0].key).not.toBe('g');
      }
    }
  });
});
