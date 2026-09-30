import { describe, expect, it, vi } from 'vitest';
import { settle } from '@/lib/settle';

describe('settle', () => {
  it('passes a Result through', async () => {
    expect(await settle(Promise.resolve({ ok: true as const, data: 1 }))).toEqual({ ok: true, data: 1 });
  });

  it('turns a rejected call into an error Result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await settle(Promise.reject(new TypeError('Failed to fetch')));
    expect(result.ok).toBe(false);
  });

  it('lets a redirect through to the router', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/auth/sign-in;307;' });
    await expect(settle(Promise.reject(redirect))).rejects.toBe(redirect);
  });
});
