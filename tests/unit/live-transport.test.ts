import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_POLL_HEADER } from '@/lib/request-tracker';
import { createPollingTransport } from '@/lib/live/transport';

type Doc = EventTarget & { visibilityState: DocumentVisibilityState };

let doc: Doc;
let win: EventTarget;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const json = (version: number) => new Response(JSON.stringify({ version }), { status: 200 });

function start(onVersion = vi.fn()) {
  const transport = createPollingTransport('acme', {
    fetch: fetchMock as never, doc: doc as never, win: win as never,
  });
  const stop = transport.subscribe(onVersion);
  return { onVersion, stop, transport };
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

  it('drops the answer of a poll that was in flight when unsubscribed', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { onVersion, stop } = start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    answer(json(9));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onVersion).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops polling and listening when unsubscribed', async () => {
    const { stop } = start();
    stop();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('safety mode polls every 5 min, idle or not', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    await vi.advanceTimersByTimeAsync(299_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('back to fast mode restarts the 30 s timer without checking at once', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    await vi.advanceTimersByTimeAsync(100_000);
    transport.setMode('fast');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('focus still checks at once in safety mode', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('checkNow checks at once, and is a no-op once unsubscribed', async () => {
    const { stop, transport } = start();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checkNow is a no-op after a 401 stopped it', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const { transport } = start();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checkNow during a poll in flight runs one more check when it lands', async () => {
    let answer!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { onVersion, stop, transport } = start();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    transport.checkNow();
    transport.checkNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(json(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onVersion.mock.calls).toEqual([[2], [3]]);
    stop();
  });

  it('focus during a poll in flight does not queue another', async () => {
    let answer!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { stop } = start();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('focus'));
    answer(json(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([401, 404])('calls onEnd once when %i stops it', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    const onEnd = vi.fn();
    const stop = createPollingTransport('acme', {
      fetch: fetchMock as never, doc: doc as never, win: win as never,
    }).subscribe(vi.fn(), onEnd);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
