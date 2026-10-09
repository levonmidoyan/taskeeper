import { describe, expect, it } from 'vitest';
import { formatBinding, matchStep, parseBinding } from '@/lib/shortcuts/keys';

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('parseBinding', () => {
  it('reads single keys, chords and Mod combos', () => {
    expect(parseBinding('j')).toEqual([{ key: 'j', mod: false }]);
    expect(parseBinding('g b')).toEqual([{ key: 'g', mod: false }, { key: 'b', mod: false }]);
    expect(parseBinding('Mod+k')).toEqual([{ key: 'k', mod: true }]);
    expect(parseBinding('ArrowDown')).toEqual([{ key: 'ArrowDown', mod: false }]);
    expect(parseBinding('?')).toEqual([{ key: '?', mod: false }]);
  });
});

describe('matchStep', () => {
  it('matches the exact key with no modifiers', () => {
    expect(matchStep({ key: 'j', mod: false }, ev('j'), false)).toBe(true);
    expect(matchStep({ key: 'j', mod: false }, ev('J'), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { ctrlKey: true }), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { altKey: true }), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { metaKey: true }), true)).toBe(false);
  });

  it('lets shifted symbols through (Shift is never checked)', () => {
    expect(matchStep({ key: '?', mod: false }, ev('?'), false)).toBe(true);
    expect(matchStep({ key: '#', mod: false }, ev('#'), false)).toBe(true);
  });

  it('reads Mod as Meta on Mac and Control elsewhere', () => {
    const modK = { key: 'k', mod: true };
    expect(matchStep(modK, ev('k', { metaKey: true }), true)).toBe(true);
    expect(matchStep(modK, ev('k', { ctrlKey: true }), true)).toBe(false);
    expect(matchStep(modK, ev('k', { ctrlKey: true }), false)).toBe(true);
    expect(matchStep(modK, ev('K', { ctrlKey: true }), false)).toBe(true);
    expect(matchStep(modK, ev('k'), false)).toBe(false);
  });

  it('ignores events with no key (autofill)', () => {
    expect(matchStep({ key: 'j', mod: false }, ev(undefined as unknown as string), false)).toBe(false);
  });
});

describe('formatBinding', () => {
  it('labels keys per platform', () => {
    expect(formatBinding('g b', false)).toEqual([['G'], ['B']]);
    expect(formatBinding('Mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatBinding('Mod+k', false)).toEqual([['Ctrl', 'K']]);
    expect(formatBinding('ArrowDown', false)).toEqual([['↓']]);
    expect(formatBinding('ArrowLeft', false)).toEqual([['←']]);
    expect(formatBinding('Escape', false)).toEqual([['Esc']]);
    expect(formatBinding('Delete', false)).toEqual([['Del']]);
    expect(formatBinding('?', false)).toEqual([['?']]);
  });
});
