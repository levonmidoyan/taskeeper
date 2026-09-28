import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPendingRequests, installRequestTracking, shouldTrackRequest } from '@/lib/request-tracker';

const origin = 'http://localhost:3000';

describe('shouldTrackRequest', () => {
  it('tracks same-origin requests, relative or absolute', () => {
    expect(shouldTrackRequest('/api/auth/get-session', undefined, origin)).toBe(true);
    expect(shouldTrackRequest(new URL('/w/acme', origin), { method: 'POST' }, origin)).toBe(true);
    expect(shouldTrackRequest(new Request(`${origin}/w/acme`), undefined, origin)).toBe(true);
  });

  it('skips other origins', () => {
    expect(shouldTrackRequest('https://example.com/a.png', undefined, origin)).toBe(false);
  });

  it('skips Next.js router prefetches, however the headers are passed', () => {
    expect(shouldTrackRequest('/w/acme', { headers: { 'next-router-prefetch': '1' } }, origin)).toBe(false);
    expect(shouldTrackRequest('/w/acme', { headers: { 'Next-Router-Segment-Prefetch': '/_tree' } }, origin)).toBe(false);
    const request = new Request(`${origin}/w/acme`, { headers: { 'next-router-prefetch': '1' } });
    expect(shouldTrackRequest(request, undefined, origin)).toBe(false);
  });
});

describe('installRequestTracking', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts in-flight tracked fetches until they settle, success or failure', async () => {
    let resolve!: (r: Response) => void;
    let reject!: (e: Error) => void;
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))
      .mockReturnValueOnce(new Promise<Response>((_, r) => (reject = r)))
      .mockResolvedValue(new Response());
    vi.stubGlobal('window', { fetch: fetchMock, location: { origin } });

    const uninstall = installRequestTracking();
    const ok = window.fetch('/a');
    const failed = window.fetch('/b').catch(() => undefined);
    expect(getPendingRequests()).toBe(2);

    await window.fetch('/c', { headers: { 'next-router-prefetch': '1' } });
    expect(getPendingRequests()).toBe(2);

    resolve(new Response());
    await ok;
    expect(getPendingRequests()).toBe(1);

    reject(new Error('offline'));
    await failed;
    expect(getPendingRequests()).toBe(0);

    uninstall();
    expect(window.fetch).toBe(fetchMock);
  });
});
