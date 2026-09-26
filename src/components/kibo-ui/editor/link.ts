const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/**
 * Kibo's link selector accepted anything `new URL()` parses — including javascript:.
 * Only web and mail links are allowed; a bare domain gets https://.
 */
export function normalizeLinkUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;

  const candidates = /^[a-z][a-z0-9+.-]*:/i.test(text) ? [text] : [`https://${text}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (!ALLOWED.has(url.protocol)) return null;
      if (url.protocol !== 'mailto:' && !url.hostname.includes('.')) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}
