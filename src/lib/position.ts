import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * A sort key strictly between two neighbours. Pass null for "start of list" or
 * "end of list". Writing one row per move is the whole point: integer positions
 * would require renumbering every row after the insertion point (spec §3.3).
 */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** n ascending keys, for seeding a fresh list such as a project's default statuses. */
export function positionsForCount(n: number): string[] {
  if (n <= 0) return [];
  return generateNKeysBetween(null, null, n);
}
