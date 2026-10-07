import { describe, expect, it, vi } from 'vitest';
import { createPusherTransport, type PusherHealth, type PusherLike } from '@/lib/live/pusher-transport';

type Handler = (data?: unknown) => void;

function fakePusher() {
  const connection = new Map<string, Handler>();
  const channel = new Map<string, Handler>();
  const client = {
    connection: { bind: (event: string, cb: Handler) => void connection.set(event, cb) },
    subscribe: vi.fn<(name: string) => { bind: (event: string, cb: Handler) => void }>(() => ({
      bind: (event: string, cb: Handler) => void channel.set(event, cb),
    })),
    disconnect: vi.fn(),
  };
  return {
    client: client as unknown as PusherLike & typeof client,
    state: (current: string) => connection.get('state_change')!({ previous: 'x', current }),
    emit: (event: string, data?: unknown) => channel.get(event)!(data),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function start(fake = fakePusher(), connect = vi.fn(async () => fake.client)) {
  const health: PusherHealth[] = [];
  const onVersion = vi.fn();
  const stop = createPusherTransport({
    workspaceId: 'w1', key: 'key', cluster: 'eu', onHealth: (h) => health.push(h), connect,
  }).subscribe(onVersion);
  await flush();
  return { fake, connect, health, onVersion, stop };
}

// start() for fake timers: flush the connect promise with microtasks only.
async function startFake(fake = fakePusher()) {
  const health: PusherHealth[] = [];
  const stop = createPusherTransport({
    workspaceId: 'w1', key: 'key', cluster: 'eu', onHealth: (h) => health.push(h), connect: async () => fake.client,
  }).subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  return { fake, health, stop };
}

describe('createPusherTransport', () => {
  it('connects with the key and cluster and subscribes the workspace channel', async () => {
    const { fake, connect, stop } = await start();
    expect(connect).toHaveBeenCalledWith('key', 'eu');
    expect(fake.client.subscribe).toHaveBeenCalledWith('private-workspace-w1');
    stop();
  });

  it('is healthy only once connected and subscribed, reported once', async () => {
    const { fake, health, stop } = await start();
    fake.state('connecting');
    fake.state('connected');
    expect(health).toEqual(['unhealthy']);
    fake.emit('pusher:subscription_succeeded');
    fake.emit('pusher:subscription_succeeded');
    expect(health).toEqual(['unhealthy', 'healthy']);
    stop();
  });

  it.each(['unavailable', 'failed', 'disconnected'])('%s is unhealthy', async (state) => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_succeeded');
    fake.state(state);
    expect(health.at(-1)).toBe('unhealthy');
    stop();
  });

  it('after a reconnect waits for the new subscription before healthy again', async () => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_succeeded');
    fake.state('connecting');
    fake.state('connected');
    expect(health.at(-1)).toBe('unhealthy');
    fake.emit('pusher:subscription_succeeded');
    expect(health.at(-1)).toBe('healthy');
    stop();
  });

  it('a subscription_error with another status is unhealthy and keeps the socket', async () => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_error', { type: 'AuthError', status: 500 });
    expect(health.at(-1)).toBe('unhealthy');
    expect(fake.client.disconnect).not.toHaveBeenCalled();
    stop();
  });

  it('retries a subscription that failed with another status, 5 s doubling to 60 s', async () => {
    vi.useFakeTimers();
    try {
      const { fake, health, stop } = await startFake();
      fake.state('connected');
      expect(fake.client.subscribe).toHaveBeenCalledTimes(1);
      for (const [wait, calls] of [[5_000, 2], [10_000, 3], [20_000, 4], [40_000, 5], [60_000, 6], [60_000, 7]]) {
        fake.emit('pusher:subscription_error', { type: 'AuthError', status: 503 });
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(fake.client.subscribe).toHaveBeenCalledTimes(calls - 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fake.client.subscribe).toHaveBeenLastCalledWith('private-workspace-w1');
        expect(fake.client.subscribe).toHaveBeenCalledTimes(calls);
      }
      fake.emit('pusher:subscription_succeeded');
      expect(health.at(-1)).toBe('healthy');
      // Success resets the backoff.
      fake.emit('pusher:subscription_error', { type: 'AuthError', status: 503 });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fake.client.subscribe).toHaveBeenCalledTimes(8);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unsubscribe cancels a pending subscription retry', async () => {
    vi.useFakeTimers();
    try {
      const { fake, stop } = await startFake();
      fake.state('connected');
      fake.emit('pusher:subscription_error', { type: 'AuthError', status: 500 });
      stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.client.subscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403])('subscription_error %i stops for good (signed out or removed)', async (status) => {
    const { fake, health, onVersion } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_error', { type: 'AuthError', status });
    expect(health.at(-1)).toBe('stopped');
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
    fake.emit('change', { version: 9 });
    fake.state('connected');
    expect(onVersion).not.toHaveBeenCalled();
    expect(health.at(-1)).toBe('stopped');
  });

  it('forwards numeric change versions and ignores anything else', async () => {
    const { fake, onVersion, stop } = await start();
    fake.emit('change', { version: 4 });
    fake.emit('change', { version: '5' });
    fake.emit('change', null);
    expect(onVersion.mock.calls).toEqual([[4]]);
    stop();
  });

  it('a client that fails to load is unhealthy', async () => {
    const { health } = await start(fakePusher(), vi.fn(async () => { throw new Error('chunk failed'); }));
    expect(health).toEqual(['unhealthy']);
  });

  it('unsubscribe before the client loads disconnects the late client and reports nothing', async () => {
    const fake = fakePusher();
    let resolve!: (client: PusherLike) => void;
    const health: PusherHealth[] = [];
    const stop = createPusherTransport({
      workspaceId: 'w1', key: 'key', cluster: 'eu', onHealth: (h) => health.push(h),
      connect: () => new Promise((r) => { resolve = r; }),
    }).subscribe(vi.fn());
    stop();
    resolve(fake.client);
    await flush();
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.client.subscribe).not.toHaveBeenCalled();
    expect(health).toEqual([]);
  });

  it('unsubscribe disconnects', async () => {
    const { fake, stop } = await start();
    stop();
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
  });
});
