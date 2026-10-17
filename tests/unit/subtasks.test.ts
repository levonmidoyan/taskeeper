import { describe, expect, it } from 'vitest';
import { progressPercent, splitPastedLines, stepTarget } from '@/lib/subtasks';

describe('splitPastedLines', () => {
  it('splits on any newline, trims and drops blanks', () => {
    expect(splitPastedLines(' one \r\ntwo\n\n  \rthree ')).toEqual(['one', 'two', 'three']);
  });
  it('strips list markers and checkboxes', () => {
    expect(splitPastedLines('- a\n* b\n• c\n1. d\n2) e\n[ ] f\n[x] g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
  it('keeps a single line as one item', () => {
    expect(splitPastedLines('just one')).toEqual(['just one']);
  });
  it('returns nothing for whitespace', () => {
    expect(splitPastedLines(' \n\t\n')).toEqual([]);
  });
});

describe('stepTarget', () => {
  const ids = ['a', 'b', 'c'];
  it('moves down one place', () => {
    expect(stepTarget(ids, 'a', 1)).toEqual({ toIndex: 1, beforeId: 'b', afterId: 'c' });
  });
  it('moves up one place', () => {
    expect(stepTarget(ids, 'c', -1)).toEqual({ toIndex: 1, beforeId: 'a', afterId: 'b' });
  });
  it('is null past either end', () => {
    expect(stepTarget(ids, 'a', -1)).toBeNull();
    expect(stepTarget(ids, 'c', 1)).toBeNull();
  });
});

describe('progressPercent', () => {
  it('rounds and handles empty', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(3, 3)).toBe(100);
  });
});
