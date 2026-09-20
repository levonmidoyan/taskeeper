import { describe, expect, it } from 'vitest';
import { positionBetween, positionsForCount } from '@/lib/position';
import { newId } from '@/lib/ids';

describe('positionBetween', () => {
  it('produces a key for an empty list', () => {
    const only = positionBetween(null, null);
    expect(typeof only).toBe('string');
    expect(only.length).toBeGreaterThan(0);
  });

  it('produces a key that sorts before an existing first item', () => {
    const first = positionBetween(null, null);
    expect(positionBetween(null, first) < first).toBe(true);
  });

  it('produces a key that sorts after an existing last item', () => {
    const last = positionBetween(null, null);
    expect(positionBetween(last, null) > last).toBe(true);
  });

  it('produces a key strictly between two neighbours', () => {
    const a = positionBetween(null, null);
    const b = positionBetween(a, null);
    const mid = positionBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('survives repeated insertion between the same two neighbours', () => {
    // Integer positions would collide here after one insert; fractional keys
    // must keep subdividing without ever producing a duplicate.
    let lo = positionBetween(null, null);
    const hi = positionBetween(lo, null);
    const seen = new Set([lo, hi]);
    for (let i = 0; i < 50; i++) {
      const mid = positionBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      lo = mid;
    }
  });
});

describe('positionsForCount', () => {
  it('returns n ascending keys', () => {
    const keys = positionsForCount(3);
    expect(keys).toHaveLength(3);
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns an empty array for zero', () => {
    expect(positionsForCount(0)).toEqual([]);
  });
});

describe('newId', () => {
  it('returns distinct url-safe ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });
});
