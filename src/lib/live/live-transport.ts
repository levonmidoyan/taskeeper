import type { PusherClientConfig } from '@/lib/live/channel';
import { createPusherTransport, type PusherHealth } from '@/lib/live/pusher-transport';
import { createPollingTransport, type ChangeTransport, type PollingTransport } from '@/lib/live/transport';

/**
 * What LiveRefresh subscribes to. Without Pusher config: polling, as before.
 * With it: Pusher carries changes and polling drops to a 5-minute safety net
 * while Pusher is healthy, back to 30 s whenever it is not (bad key or secret,
 * outage, blocked websocket). Bursts of Pusher events are coalesced.
 */
export function createLiveTransport({
  slug,
  workspaceId,
  pusher,
  debounceMs = 500,
  polling = createPollingTransport(slug),
  pusherTransport,
}: {
  slug: string;
  workspaceId: string;
  pusher: PusherClientConfig | null;
  debounceMs?: number;
  polling?: PollingTransport;
  /** Tests hand in a fake; by default the pusher-js one. */
  pusherTransport?: (onHealth: (health: PusherHealth) => void) => ChangeTransport;
}): ChangeTransport {
  return {
    subscribe(onVersion) {
      const stopPolling = polling.subscribe(onVersion);
      if (!pusher) return stopPolling;

      let healthy = false;
      function onHealth(health: PusherHealth) {
        if (health === 'healthy') {
          healthy = true;
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
      const stopPusher = make(onHealth).subscribe((version) => {
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
        stopPusher();
        stopPolling();
      };
    },
  };
}
