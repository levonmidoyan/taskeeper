import { describe, expect, it } from 'vitest';
import { PUSH_DEFAULTS, pushAllowed } from '@/lib/push';

describe('pushAllowed', () => {
  const all = { reminders: true, mentions: true, taskChanges: true, projectChanges: true };
  const none = { reminders: false, mentions: false, taskChanges: false, projectChanges: false };

  it('maps each kind to its own toggle', () => {
    expect(pushAllowed('reminder', { ...none, reminders: true })).toBe(true);
    expect(pushAllowed('mention', { ...none, mentions: true })).toBe(true);
    expect(pushAllowed('task_change', { ...none, taskChanges: true })).toBe(true);
    expect(pushAllowed('project_change', { ...none, projectChanges: true })).toBe(true);
    expect(pushAllowed('mention', { ...all, mentions: false })).toBe(false);
  });

  it('never pushes the digest', () => {
    expect(pushAllowed('digest', all)).toBe(false);
  });

  it('defaults: project changes off, the rest on', () => {
    expect(PUSH_DEFAULTS).toEqual({ reminders: true, mentions: true, taskChanges: true, projectChanges: false });
  });
});
