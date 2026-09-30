import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
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

/**
 * n ascending keys after an existing one, for appending a batch to the end of a
 * list — reassigning a deleted column's tasks onto the end of another column,
 * say. Their relative order is the order they are passed in.
 */
export function positionsAfter(last: string | null, n: number): string[] {
  if (n <= 0) return [];
  return generateNKeysBetween(last, null, n);
}

/**
 * Tiebreak for rows that share a position: id in codepoint order, the same order
 * JS string comparison gives. The database's en_US collation would sort nanoid's
 * `-`, `_` and mixed case differently from the server's checks.
 */
export function byId(column: AnyPgColumn) {
  return sql`${column} collate "C"`;
}

/**
 * A position column in codepoint order, the order fractional-indexing keys are
 * built for. Under a locale collation (glibc's or ICU's en_US) 'aB' sorts
 * after 'ab', so boards would list out of key order and "the last key" read to
 * append after could be one that is not the largest.
 */
export function byKey(column: AnyPgColumn) {
  return sql`${column} collate "C"`;
}
