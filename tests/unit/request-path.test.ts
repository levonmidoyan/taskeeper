import { describe, expect, it } from 'vitest';
import { redirectToFromPath } from '@/lib/request-path';

// Must match better-auth-ui's client getter (?redirectTo= trimmed, else the
// default), or server-rendered auth links hydrate with a different href.
describe('redirectToFromPath', () => {
  it('reads ?redirectTo= from the forwarded path', () => {
    expect(redirectToFromPath('/auth/sign-up?redirectTo=%2Finvite%2Fabc')).toBe('/invite/abc');
  });

  it('trims it like the client does', () => {
    expect(redirectToFromPath('/auth/sign-in?redirectTo=%20%2Fx%20')).toBe('/x');
  });

  it('never returns an off-site destination', () => {
    expect(redirectToFromPath('/auth/sign-in?redirectTo=https%3A%2F%2Fevil.example')).toBe('/');
    expect(redirectToFromPath('/auth/sign-in?redirectTo=%2F%2Fevil.example')).toBe('/');
  });

  it('falls back to / when it is missing or blank', () => {
    expect(redirectToFromPath('/auth/sign-in')).toBe('/');
    expect(redirectToFromPath('/auth/sign-in?redirectTo=%20')).toBe('/');
    expect(redirectToFromPath(null)).toBe('/');
  });
});
