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

/**
 * Descriptions are Markdown and ts_headline returns source text, so a snippet
 * would show "**Deploy** the [«api»](https://…)". Strips the syntax a person
 * would not see rendered, keeping the «» highlight markers and in-word
 * underscores (snake_case).
 */
export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+\.[ \t]+)/gm, '')
    .replace(/\*+|~~|`+/g, '')
    .replace(/(^|[^\p{L}\p{N}_])_+|_+(?=[^\p{L}\p{N}_]|$)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
