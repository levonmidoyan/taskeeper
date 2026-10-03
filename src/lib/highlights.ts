export type HighlightPart = { text: string; mark: boolean };

/**
 * Splits a search snippet marked «like this» into parts to render as text and
 * <mark>. Everything stays text, so nothing in a description is ever parsed as
 * HTML.
 */
export function splitHighlights(snippet: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let mark = false;
  for (const chunk of snippet.split(/([«»])/)) {
    if (chunk === '«') mark = true;
    else if (chunk === '»') mark = false;
    else if (chunk) parts.push({ text: chunk, mark });
  }
  return parts;
}
