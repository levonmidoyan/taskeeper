/**
 * Validates a `?next=` destination before redirecting to it. Only a path on this
 * origin is allowed: `//evil.example` and `https://evil.example` are both valid
 * values for `location.assign`, so echoing the parameter back unchecked would be
 * an open redirect — the classic way an invite link gets turned into a phishing
 * link.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
