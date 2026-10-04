import { LIVE_POLL_HEADER } from '@/lib/request-tracker';

/**
 * Where change notices come from. Polling today; a Pusher transport later
 * implements the same shape and LiveRefresh picks one.
 */
export type ChangeTransport = {
  /** Calls onVersion with the workspace's change counter; returns unsubscribe. */
  subscribe(onVersion: (version: number) => void): () => void;
};

export type PollingOptions = {
  intervalMs?: number;
  /** No pointer or key input for this long counts as idle. */
  idleAfterMs?: number;
  idleIntervalMs?: number;
  fetch?: typeof fetch;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
};

const INPUT_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Polls GET /api/workspaces/[slug]/changes while the tab is visible: every 30 s,
 * every 2 min once the user has been idle for 5 min, and at once when the tab
 * comes back. 401/404 (signed out, removed) stops it for good; anything else
 * that goes wrong waits for the next tick.
 */
export function createPollingTransport(slug: string, options: PollingOptions = {}): ChangeTransport {
  const { intervalMs = 30_000, idleAfterMs = 300_000, idleIntervalMs = 120_000 } = options;

  return {
    subscribe(onVersion) {
      // Through window each call, so the request tracker's wrapper (installed later) sees it.
      const doFetch: typeof fetch = options.fetch ?? ((input, init) => window.fetch(input, init));
      const doc = options.doc ?? document;
      const win = options.win ?? window;
      const url = `/api/workspaces/${encodeURIComponent(slug)}/changes`;

      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      let inFlight = false;
      let lastInput = Date.now();

      const idle = () => Date.now() - lastInput >= idleAfterMs;

      function schedule() {
        clearTimeout(timer);
        if (stopped || doc.visibilityState !== 'visible') return;
        timer = setTimeout(check, idle() ? idleIntervalMs : intervalMs);
      }

      async function check() {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const res = await doFetch(url, { headers: { [LIVE_POLL_HEADER]: '1' }, cache: 'no-store' });
          if (res.status === 401 || res.status === 404) {
            stop();
            return;
          }
          if (res.ok) {
            const body = (await res.json()) as { version?: unknown };
            if (typeof body.version === 'number') onVersion(body.version);
          }
        } catch {
          // Offline or mid-deploy: the next tick tries again.
        } finally {
          inFlight = false;
          schedule();
        }
      }

      const onVisibility = () => {
        if (doc.visibilityState === 'visible') void check();
        else clearTimeout(timer);
      };
      const onFocus = () => void check();
      const onInput = () => {
        const wasIdle = idle();
        lastInput = Date.now();
        // Back from idle: the 2-minute timer would be stale, so restart at 30 s.
        if (wasIdle) schedule();
      };

      function stop() {
        stopped = true;
        clearTimeout(timer);
        doc.removeEventListener('visibilitychange', onVisibility);
        win.removeEventListener('focus', onFocus);
        for (const type of INPUT_EVENTS) win.removeEventListener(type, onInput);
      }

      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('focus', onFocus);
      for (const type of INPUT_EVENTS) win.addEventListener(type, onInput);
      schedule();

      return stop;
    },
  };
}
