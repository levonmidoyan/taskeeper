import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Client = { url: string; focus: () => Promise<unknown>; navigate: (url: string) => Promise<unknown> };

/** Runs public/sw.js against a fake worker scope and fires one notificationclick. */
async function click(windows: Client[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const openWindow = vi.fn(async () => null);
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    clients: { matchAll: async () => windows, openWindow },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, console });
  let done: Promise<unknown> = Promise.resolve();
  listeners.notificationclick({
    notification: { close: () => {}, data: { url: '/acme/tasks/t1' } },
    waitUntil: (p: Promise<unknown>) => { done = p; },
  });
  await done;
  return openWindow;
}

describe('notificationclick', () => {
  it('navigates an open app window to the task', async () => {
    const navigate = vi.fn(async () => ({}));
    const openWindow = await click([{ url: 'https://app.test/acme', focus: async () => ({}), navigate }]);
    expect(navigate).toHaveBeenCalledWith('https://app.test/acme/tasks/t1');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when the open one refuses to navigate (not controlled by this worker)', async () => {
    const navigate = vi.fn(async () => { throw new TypeError('not controlled'); });
    const openWindow = await click([{ url: 'https://app.test/acme', focus: async () => ({}), navigate }]);
    expect(openWindow).toHaveBeenCalledWith('https://app.test/acme/tasks/t1');
  });
});
