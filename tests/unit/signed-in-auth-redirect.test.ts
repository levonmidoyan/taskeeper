import { describe, expect, it } from 'vitest';
import { signedInAuthRedirect } from '@/lib/signed-in-auth-redirect';

describe('signedInAuthRedirect', () => {
  it('sends a signed-in user away from the entry views', () => {
    for (const path of ['sign-in', 'sign-up', 'forgot-password', 'reset-link-sent', 'email-otp']) {
      expect(signedInAuthRedirect(path, {})).toBe('/');
    }
  });

  it('keeps views that are used while signed in or that finish a sign-in', () => {
    for (const path of [
      'sign-out',
      'callback',
      'redirect',
      'error',
      'verify-email',
      'reset-password',
      'two-factor',
      'device',
    ]) {
      expect(signedInAuthRedirect(path, {})).toBeNull();
    }
  });

  it('renders every view while an account is being added', () => {
    for (const path of ['sign-in', 'sign-up', 'forgot-password', 'reset-link-sent', 'email-otp']) {
      expect(signedInAuthRedirect(path, {}, { addingAccount: true })).toBeNull();
    }
  });

  it('honours a same-origin redirectTo', () => {
    expect(signedInAuthRedirect('sign-up', { redirectTo: '/invite/abc' })).toBe('/invite/abc');
  });

  it('rejects an off-origin redirectTo', () => {
    expect(signedInAuthRedirect('sign-in', { redirectTo: '//evil.example' })).toBe('/');
    expect(signedInAuthRedirect('sign-in', { redirectTo: ['https://evil.example'] })).toBe('/');
  });
});
