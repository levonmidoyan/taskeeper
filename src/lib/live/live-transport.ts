import type { PusherClientConfig } from '@/lib/live/channel';
import { createPusherTransport, type PusherHealth } from '@/lib/live/pusher-transport';
import { createPollingTransport, type ChangeTransport, type PollingTransport } from '@/lib/live/transport';

/**
 * What LiveRefresh subscribes to. Without Pusher config: polling, as before.
 * With it: Pusher carries changes and polling drops to a 5-minute safety net
 * while Pusher is healthy, back to 30 s whenever it is not (bad key or secret,
 * outage, blocked websocket). Bursts of Pusher events are coalesced.
 *
 * A healthy socket does not prove publishes work (wrong app id, REST API down,
 * quota spent). So when a poll finds a version Pusher has not announced within
 * graceMs, polling goes back to 30 s until Pusher next reconnects.
 */
export function createLiveTransport({
  slug,
  workspaceId,
  pusher,
  debounceMs = 500,
  graceMs = 5_000,
  polling = createPollingTransport(slug),
  pusherTransport,
}: {
  slug: string;
  workspaceId: string;
  pusher: PusherClientConfig | null;
  debounceMs?: number;
  /** How long Pusher gets to announce a version a poll already found. */
  graceMs?: number;
  polling?: PollingTransport;
  /** Tests hand in a fake; by default the pusher-js one. */
  pusherTransport?: (onHealth: (health: PusherHealth) => void) => ChangeTransport;
}): ChangeTransport {
  return {
    subscribe(onVersion) {
      if (!pusher) return polling.subscribe(onVersion);

      let healthy = false;
      // Highest version Pusher announced (or the first poll after a reconnect).
      let heard = 0;
      let needBaseline = true;
      let lossy = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let graceTarget = 0;

      function clearGrace() {
        clearTimeout(grace);
        grace = undefined;
        graceTarget = 0;
      }

      function onPoll(version: number) {
        onVersion(version);
        if (!healthy || lossy || needBaseline) {
          // Before Pusher could have announced it: not evidence either way.
          heard = Math.max(heard, version);
          if (healthy) needBaseline = false;
          return;
        }
        if (version <= heard) return;
        graceTarget = Math.max(graceTarget, version);
        if (grace !== undefined) return;
        grace = setTimeout(() => {
          grace = undefined;
          if (heard >= graceTarget) return;
          graceTarget = 0;
          lossy = true;
          console.warn('Live refresh: Pusher is connected but not delivering changes; polling every 30 s.');
          polling.setMode('fast');
        }, graceMs);
      }

      function onHealth(health: PusherHealth) {
        clearGrace();
        if (health === 'healthy') {
          healthy = true;
          lossy = false;
          needBaseline = true;
          polling.setMode('safety');
          // Changes made while the socket was down, or before it first
          // subscribed, sent events nobody heard.
          polling.checkNow();
          return;
        }
        if (healthy) console.warn(`Live refresh: Pusher is ${health}; polling every 30 s.`);
        healthy = false;
        polling.setMode('fast');
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending = 0;
      const make =
        pusherTransport ??
        ((h: (health: PusherHealth) => void) =>
          createPusherTransport({ workspaceId, key: pusher.key, cluster: pusher.cluster, onHealth: h }));
      const stopPolling = polling.subscribe(onPoll);
      const stopPusher = make(onHealth).subscribe((version) => {
        heard = Math.max(heard, version);
        if (grace !== undefined && heard >= graceTarget) clearGrace();
        pending = Math.max(pending, version);
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          const latest = pending;
          pending = 0;
          onVersion(latest);
        }, debounceMs);
      });

      return () => {
        clearTimeout(timer);
        clearGrace();
        stopPusher();
        stopPolling();
      };
    },
  };
}
