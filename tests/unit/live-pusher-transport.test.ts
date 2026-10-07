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
