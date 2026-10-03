import { describe, expect, it } from 'vitest';
import {
  digestKey, digestSubject, dueInLabel, hourLabel, isReminderOffset, notificationHref, notificationText,
  reminderKey, reminderSubject,
} from '@/lib/reminders';

describe('dedupe keys', () => {
  it('keys a reminder on task, user, due date and offset', () => {
    expect(reminderKey('t1', 'u1', '2026-10-10', 1)).toBe('rem:t1:u1:2026-10-10:1');
  });

  it('keys a digest on user, workspace and local date', () => {
    expect(digestKey('u1', 'w1', '2026-10-10')).toBe('dig:u1:w1:2026-10-10');
  });
});

describe('copy', () => {
  it('says today, tomorrow, or in N days', () => {
    expect(dueInLabel(0)).toBe('today');
    expect(dueInLabel(1)).toBe('tomorrow');
    expect(dueInLabel(7)).toBe('in 7 days');
  });

  it('builds the reminder subject with curly quotes', () => {
    expect(reminderSubject({ title: 'Ship v2', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 1 }))
      .toBe('“Ship v2” is due tomorrow');
  });

  it('builds the digest subject from the non-zero counts', () => {
    const base = { localDate: '2026-10-10', tasks: [] };
    expect(digestSubject({ ...base, dueToday: 3, overdue: 2 }, 'Acme')).toBe('3 due today · 2 overdue in Acme');
    expect(digestSubject({ ...base, dueToday: 0, overdue: 1 }, 'Acme')).toBe('1 overdue in Acme');
    expect(digestSubject({ ...base, dueToday: 1, overdue: 0 }, 'Acme')).toBe('1 due today in Acme');
  });

  it('formats an hour as HH:00', () => {
    expect(hourLabel(9)).toBe('09:00');
    expect(hourLabel(23)).toBe('23:00');
  });
});

describe('isReminderOffset', () => {
  it('accepts only 0, 1, 2 and 7', () => {
    expect([0, 1, 2, 7].every(isReminderOffset)).toBe(true);
    expect([3, -1, 1.5, '1', null].some(isReminderOffset)).toBe(false);
  });
});

describe('bell item text and link', () => {
  it('describes a reminder by its task', () => {
    const item = { kind: 'reminder' as const, taskId: 't1', data: { title: 'Ship', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 0 as const } };
    expect(notificationText(item)).toEqual({ title: 'Ship', detail: 'Due today · Web' });
    expect(notificationHref('acme', item)).toBe('/acme/tasks/t1');
  });

  it('describes a digest by its counts and links to my calendar', () => {
    const item = { kind: 'digest' as const, taskId: null, data: { localDate: '2026-10-10', dueToday: 2, overdue: 1, tasks: [] } };
    expect(notificationText(item)).toEqual({ title: 'Daily digest', detail: '2 due today · 1 overdue' });
    expect(notificationHref('acme', item)).toBe('/acme/calendar');
  });
});
