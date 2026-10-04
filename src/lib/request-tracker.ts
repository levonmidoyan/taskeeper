/**
 * Counts in-flight same-origin fetches so the top loading bar can show while the
 * app waits on the server. Client navigations, server actions and auth calls all
 * go through window.fetch, so wrapping it covers every request without each call
 * site opting in.
 */

/** Sent by the live-refresh poll (src/lib/live/transport.ts). */
export const LIVE_POLL_HEADER = 'x-live-poll';

// Next.js router prefetches run in the background on hover/viewport and never
// block the user, so they must not flash the bar. Neither must the live-refresh
// poll, which also must not count as the user's own request in flight.
const UNTRACKED_HEADERS = ['next-router-prefetch', 'next-router-segment-prefetch', LIVE_POLL_HEADER];

let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingRequests() {
  return pending;
}

export function shouldTrackRequest(input: RequestInfo | URL, init: RequestInit | undefined, origin: string) {
  const request = input instanceof Request ? input : undefined;
  const url = new URL(request ? request.url : String(input), origin);
  if (url.origin !== origin) return false;

  const headers = new Headers(init?.headers ?? request?.headers);
  return !UNTRACKED_HEADERS.some((name) => headers.has(name));
}

/** Wraps window.fetch; returns a function that restores it. Safe to call twice. */
export function installRequestTracking() {
  const original = window.fetch;

  const tracked: typeof window.fetch = (input, init) => {
    let track = false;
    try {
      track = shouldTrackRequest(input, init, window.location.origin);
    } catch {
      // An unparsable URL is fetch's error to report, not ours.
    }
    if (!track) return original(input, init);

    pending += 1;
    emit();
    const done = () => {
      pending -= 1;
      emit();
    };
    try {
      const response = original(input, init);
      response.then(done, done);
      return response;
    } catch (error) {
      done();
      throw error;
    }
  };

  window.fetch = tracked;
  return () => {
    // Leave a later wrapper (another library, a test lock) in place.
    if (window.fetch === tracked) window.fetch = original;
  };
}
