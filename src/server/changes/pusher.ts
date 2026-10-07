import Pusher from 'pusher';
import type { PusherClientConfig } from '@/lib/live/channel';

type PusherEnv = { appId: string; key: string; secret: string; cluster: string };

/** Read per call, not at import, so tests can switch Pusher on and off. */
function pusherEnv(): PusherEnv | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return null;
  return { appId, key, secret, cluster };
}

/** The public half, for the browser. null = live refresh polls only. */
export function pusherClientConfig(): PusherClientConfig | null {
  const env = pusherEnv();
  return env ? { key: env.key, cluster: env.cluster } : null;
}

let cached: { signature: string; client: Pusher } | null = null;

export function pusherServer(): Pusher | null {
  const env = pusherEnv();
  if (!env) return null;
  const signature = [env.appId, env.key, env.secret, env.cluster].join('|');
  if (cached?.signature === signature) return cached.client;
  const client = new Pusher({ ...env, useTLS: true });
  cached = { signature, client };
  return client;
}
