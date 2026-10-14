import { describe, expect, it } from 'vitest';
import { pushSupport, urlBase64ToUint8Array } from '@/lib/push-client';

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    expect([...urlBase64ToUint8Array('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });
});

describe('pushSupport', () => {
  const ok = { hasServiceWorker: true, hasPushManager: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', standalone: false };
  it('ok on a desktop browser with push', () => expect(pushSupport(ok)).toBe('ok'));
  it('asks iOS users to install first', () => {
    expect(pushSupport({ ...ok, hasPushManager: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('ios-install');
  });
  it('ok on iOS once installed', () => {
    expect(pushSupport({ ...ok, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', standalone: true })).toBe('ok');
  });
  it('unsupported without a service worker', () => expect(pushSupport({ ...ok, hasServiceWorker: false })).toBe('unsupported'));
});
