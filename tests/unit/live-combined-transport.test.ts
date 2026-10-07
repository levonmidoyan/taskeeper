import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveTransport } from '@/lib/live/live-transport';
import type { PusherHealth } from '@/lib/live/pusher-transport';
import type { PollingTransport } from '@/lib/live/transport';

let stopPolling: ReturnType<typeof vi.fn>;
let polling: PollingTransport & { subscribe: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn>; checkNow: ReturnType<typeof vi.fn> };
let stopPusher: ReturnType<typeof vi.fn>;
let health: (h: PusherHealth) => void;
let pusherVersion: (v: number) => void;
let pusherTransport: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  stopPolling = vi.fn();
  polling = { subscribe: vi.fn(() => stopPolling), setMode: vi.fn(), checkNow: vi.fn() } as never;
  stopPusher = vi.fn();
  pusherTransport = vi.fn((onHealth: (h: PusherHealth) => void) => {
    health = onHealth;
    return {
      subscribe: (onVersion: (v: number) => void) => {
        pusherVersion = onVersion;
        return stopPusher;
      },
    };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(pusher: { key: string; cluster: string } | null = { key: 'key', cluster: 'eu' }) {
  const onVersion = vi.fn();
  const stop = createLiveTransport({
    slug: 'acme', workspaceId: 'w1', pusher, polling, pusherTransport: pusherTransport as never,
  }).subscribe(onVersion);
  return { onVersion, stop };
}

describe('createLiveTransport', () => {
  it('without Pusher config it is polling alone', () => {
    const { onVersion, stop } = start(null);
    expect(polling.subscribe).toHaveBeenCalledWith(onVersion);
    expect(pusherTransport).not.toHaveBeenCalled();
    stop();
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });

  it('polls fast until Pusher is healthy, then slows to the safety net', () => {
    const { stop } = start();
    expect(polling.setMode).not.toHaveBeenCalled();
    health('healthy');
    expect(polling.setMode).toHaveBeenLastCalledWith('safety');
    stop();
  });

  it('polls once on every return to healthy (events missed while down)', () => {
    const { stop } = start();
    health('healthy');
    expect(polling.checkNow).toHaveBeenCalledTimes(1);
    health('unhealthy');
    health('healthy');
    expect(polling.checkNow).toHaveBeenCalledTimes(2);
    stop();
  });

  it('falls back to fast polling and warns once per fall-back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { stop } = start();
    health('unhealthy');
    expect(warn).not.toHaveBeenCalled();
    health('healthy');
    health('unhealthy');
    expect(polling.setMode).toHaveBeenLastCalledWith('fast');
    health('unhealthy');
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stopped Pusher leaves fast polling to find out about the session', () => {
    const { stop } = start();
    health('healthy');
    health('stopped');
    expect(polling.setMode).toHaveBeenLastCalledWith('fast');
    stop();
  });

  it('coalesces Pusher events for 500 ms and forwards the highest version', async () => {
    const { onVersion, stop } = start();
    pusherVersion(4);
    pusherVersion(6);
    pusherVersion(5);
    await vi.advanceTimersByTimeAsync(499);
    expect(onVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onVersion.mock.calls).toEqual([[6]]);
    pusherVersion(7);
    await vi.advanceTimersByTimeAsync(500);
    expect(onVersion.mock.calls).toEqual([[6], [7]]);
    stop();
  });

  it('unsubscribe stops both and drops a pending event', async () => {
    const { onVersion, stop } = start();
    pusherVersion(4);
    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onVersion).not.toHaveBeenCalled();
    expect(stopPusher).toHaveBeenCalledTimes(1);
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });
});
