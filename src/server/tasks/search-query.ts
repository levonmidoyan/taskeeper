const MAX_TERMS = 8;

/**
 * Builds a prefix tsquery from what the person typed, so "deplo" already finds
 * "Deployment". Only letters and digits survive, so the result cannot carry
 * tsquery operators; it is still always passed as a bound parameter. Null when
 * nothing searchable is left.
 */
export function toPrefixQuery(term: string): string | null {
  const tokens = term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(' & ') : null;
}
