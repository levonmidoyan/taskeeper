import { CHANGE_EVENT, workspaceChannel } from '@/lib/live/channel';
import type { ChangeTransport } from '@/lib/live/transport';

export const PUSHER_AUTH_ENDPOINT = '/api/pusher/auth';

/** healthy = connected and subscribed; stopped = auth refused, never retried. */
export type PusherHealth = 'healthy' | 'unhealthy' | 'stopped';

type Bindable = { bind(event: string, callback: (data?: unknown) => void): unknown };

/** The slice of pusher-js this uses, so tests can hand in a fake. */
export type PusherLike = {
  connection: Bindable;
  subscribe(channelName: string): Bindable;
  disconnect(): void;
};

export type PusherConnect = (key: string, cluster: string) => Promise<PusherLike>;

// Loaded on first use so pusher-js stays out of the initial bundle.
const connectPusher: PusherConnect = async (key, cluster) => {
  const { default: Pusher } = await import('pusher-js');
  return new Pusher(key, {
    cluster,
    channelAuthorization: { endpoint: PUSHER_AUTH_ENDPOINT, transport: 'ajax' },
  });
};

const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * Change notices from the workspace's private Pusher channel. Reports its
 * health so live-transport.ts can poll faster while it is down; pusher-js
 * reconnects on its own. Auth refused (401/403: signed out, removed) stops it;
 * any other failed subscription (a 5xx from the auth route) is retried, 5 s
 * doubling to 60 s.
 */
export function createPusherTransport({
  workspaceId,
  key,
  cluster,
  onHealth,
  connect = connectPusher,
  retryFirstMs = RETRY_FIRST_MS,
  retryMaxMs = RETRY_MAX_MS,
}: {
  workspaceId: string;
  key: string;
  cluster: string;
  onHealth(health: PusherHealth): void;
  connect?: PusherConnect;
  retryFirstMs?: number;
  retryMaxMs?: number;
}): ChangeTransport {
  return {
    subscribe(onVersion) {
      let stopped = false;
      let client: PusherLike | null = null;
      let connected = false;
      let subscribed = false;
      let last: PusherHealth | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let retryMs = retryFirstMs;

      function report(health: PusherHealth) {
        if (stopped || health === last) return;
        last = health;
        onHealth(health);
      }
      const update = () => report(connected && subscribed ? 'healthy' : 'unhealthy');

      function stop() {
        stopped = true;
        clearTimeout(retry);
        client?.disconnect();
        client = null;
      }

      connect(key, cluster).then(
        (c) => {
          if (stopped) {
            c.disconnect();
            return;
          }
          client = c;
          c.connection.bind('state_change', (data) => {
            connected = (data as { current?: string } | undefined)?.current === 'connected';
            // pusher-js subscribes again after a reconnect and says so.
            if (!connected) subscribed = false;
            update();
          });
          const name = workspaceChannel(workspaceId);
          const channel = c.subscribe(name);
          channel.bind('pusher:subscription_succeeded', () => {
            subscribed = true;
            retryMs = retryFirstMs;
            update();
          });
          channel.bind('pusher:subscription_error', (data) => {
            subscribed = false;
            const status = (data as { status?: number } | undefined)?.status;
            if (status === 401 || status === 403) {
              report('stopped');
              stop();
              return;
            }
            update();
            // Same channel object, so the bindings here stay. pusher-js also
            // subscribes again by itself after a reconnect.
            clearTimeout(retry);
            retry = setTimeout(() => {
              if (!stopped) c.subscribe(name);
            }, retryMs);
            retryMs = Math.min(retryMs * 2, retryMaxMs);
          });
          channel.bind(CHANGE_EVENT, (data) => {
            const version = (data as { version?: unknown } | null | undefined)?.version;
            if (!stopped && typeof version === 'number') onVersion(version);
          });
        },
        () => report('unhealthy'),
      );

      return stop;
    },
  };
}
