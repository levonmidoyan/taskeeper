import { describe, expect, it } from 'vitest';
import { accountTabLabel } from '@/components/settings/AccountBreadcrumb';

describe('accountTabLabel', () => {
  it('names every account tab', () => {
    expect(accountTabLabel('account')).toBe('Profile');
    expect(accountTabLabel('security')).toBe('Security');
    expect(accountTabLabel('preferences')).toBe('Preferences');
  });

  it('falls back to Settings for an unknown segment', () => {
    expect(accountTabLabel('settings')).toBe('Settings');
  });
});
