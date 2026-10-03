export type HighlightPart = { text: string; mark: boolean };

/**
 * Private-use code points that wrap matched words in a search snippet. Real
 * text never carries them (the query strips any that slip in), so a literal
 * « or » in a description stays text instead of opening a highlight.
 */
export const MARK_START = '';
export const MARK_END = '';

/**
 * Splits a search snippet with marked words into parts to render as text and
 * <mark>. Everything stays text, so nothing in a description is ever parsed as
 * HTML.
 */
export function splitHighlights(snippet: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let mark = false;
  for (const chunk of snippet.split(/([])/)) {
    if (chunk === MARK_START) mark = true;
    else if (chunk === MARK_END) mark = false;
    else if (chunk) parts.push({ text: chunk, mark });
  }
  return parts;
}
