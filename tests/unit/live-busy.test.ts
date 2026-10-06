// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const pending = { n: 0 };
const requestListeners = new Set<() => void>();
vi.mock('@/lib/request-tracker', () => ({
  getPendingRequests: () => pending.n,
  subscribeToRequests: (l: () => void) => {
    requestListeners.add(l);
    return () => requestListeners.delete(l);
  },
}));

const { REQUEST_SETTLE_MS, endSettle, isBusy, isTextEntry, markBusy, releaseBusy, subscribeBusy } = await import('@/lib/live/busy');

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
  pending.n = 0;
  releaseBusy('drag');
});

describe('isTextEntry', () => {
  it('counts text inputs, textareas and contenteditable', () => {
    expect(isTextEntry(mount('<input type="text">'))).toBe(true);
    expect(isTextEntry(mount('<input>'))).toBe(true);
    expect(isTextEntry(mount('<textarea></textarea>'))).toBe(true);
    expect(isTextEntry(mount('<div contenteditable="true"><p>x</p></div>'))).toBe(true);
    const inner = mount('<div contenteditable="true"><p>x</p></div>').querySelector('p');
    expect(isTextEntry(inner)).toBe(true);
    expect(isTextEntry(mount('<div contenteditable="plaintext-only"></div>'))).toBe(true);
  });

  it('counts a focused select: arrow keys and type-ahead change it', () => {
    expect(isTextEntry(mount('<select><option>A</option></select>'))).toBe(true);
  });

  it('a checkbox, a button or nothing is not typing', () => {
    expect(isTextEntry(mount('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(mount('<button>Board</button>'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('isBusy', () => {
  it('while a drag is held', () => {
    expect(isBusy()).toBe(false);
    markBusy('drag');
    expect(isBusy()).toBe(true);
    releaseBusy('drag');
    expect(isBusy()).toBe(false);
  });

  it('while a text field has focus, not a checkbox', () => {
    mount('<input type="text">').focus();
    expect(isBusy()).toBe(true);
    mount('<input type="checkbox">').focus();
    expect(isBusy()).toBe(false);
  });

  it('while one of my requests is in flight', () => {
    pending.n = 1;
    expect(isBusy()).toBe(true);
  });
});

describe('subscribeBusy', () => {
  it('fires on drag changes, request settles and (a tick later) focus changes', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const stop = subscribeBusy(listener);

    markBusy('drag');
    expect(listener).toHaveBeenCalledTimes(1);

    for (const l of requestListeners) l();
    expect(listener).toHaveBeenCalledTimes(2);

    const input = mount('<input type="text">');
    input.focus();
    input.blur();
    expect(listener).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(4);

    stop();
    releaseBusy('drag');
    expect(listener).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});

describe('after my request settles', () => {
  it('stays busy a moment for the page update to land, then tells listeners', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const stop = subscribeBusy(listener);

    pending.n = 1;
    for (const l of requestListeners) l();
    pending.n = 0;
    for (const l of requestListeners) l();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(isBusy()).toBe(true);

    await vi.advanceTimersByTimeAsync(REQUEST_SETTLE_MS - 1);
    expect(isBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isBusy()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    vi.useRealTimers();
  });

  it('stops holding as soon as the page my request carried renders', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const stop = subscribeBusy(listener);

    pending.n = 1;
    for (const l of requestListeners) l();
    pending.n = 0;
    for (const l of requestListeners) l();
    expect(isBusy()).toBe(true);

    endSettle();
    expect(isBusy()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);

    // Nothing to end: no extra notification.
    endSettle();
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    vi.useRealTimers();
  });
});
