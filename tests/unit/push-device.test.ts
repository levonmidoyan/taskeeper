import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/push/actions', () => ({ subscribePushAction: vi.fn(), unsubscribePushAction: vi.fn() }));

const { pushRegistration } = await import('@/lib/push-device');

function stubWorkers(existing: unknown, ready: Promise<unknown>) {
  const register = vi.fn(async () => ({}));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn(async () => existing), register, ready } });
  return register;
}

describe('pushRegistration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers the worker when none is (next dev skips it) and waits for it', async () => {
    const active = { pushManager: {} };
    const register = stubWorkers(undefined, Promise.resolve(active));
    await expect(pushRegistration()).resolves.toBe(active);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('reuses an existing registration', async () => {
    const active = { pushManager: {} };
    const register = stubWorkers(active, Promise.resolve(active));
    await expect(pushRegistration()).resolves.toBe(active);
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects instead of hanging when the worker never becomes ready', async () => {
    stubWorkers({}, new Promise(() => {}));
    await expect(pushRegistration(20)).rejects.toThrow('did not become ready');
  });
});
