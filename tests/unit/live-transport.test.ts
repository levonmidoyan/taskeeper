import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_POLL_HEADER } from '@/lib/request-tracker';
import { createPollingTransport } from '@/lib/live/transport';

type Doc = EventTarget & { visibilityState: DocumentVisibilityState };

let doc: Doc;
let win: EventTarget;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const json = (version: number) => new Response(JSON.stringify({ version }), { status: 200 });

function start(onVersion = vi.fn()) {
  const stop = createPollingTransport('acme', {
    fetch: fetchMock as never, doc: doc as never, win: win as never,
  }).subscribe(onVersion);
  return { onVersion, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  win = new EventTarget();
  fetchMock = vi.fn<typeof fetch>(async () => json(3));
});
afterEach(() => vi.useRealTimers());

describe('createPollingTransport', () => {
  it('polls every 30 s with the poll header and reports the version', async () => {
    const { onVersion, stop } = start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/acme/changes');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ [LIVE_POLL_HEADER]: '1' });
    expect(onVersion).toHaveBeenCalledWith(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not poll while hidden, and checks at once when visible again', async () => {
    const { stop } = start();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('checks at once on window focus', async () => {
    const { stop } = start();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('backs off to 2 min after 5 min without input, and returns to 30 s on input', async () => {
    const { stop } = start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(11);

    win.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    stop();
  });

  it.each([401, 404])('stops for good on %i (signed out or removed)', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    const { onVersion } = start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onVersion).not.toHaveBeenCalled();
  });

  it('ignores network errors and server errors, and tries again next tick', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const { onVersion, stop } = start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onVersion).toHaveBeenCalledWith(3);
    stop();
  });

  it('stops polling and listening when unsubscribed', async () => {
    const { stop } = start();
    stop();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
