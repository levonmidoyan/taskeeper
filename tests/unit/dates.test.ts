import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  formatDueDate,
  formatInZone,
  isOverdue,
  todayInZone,
} from '@/lib/dates';

const YEREVAN = 'Asia/Yerevan';

describe('todayInZone', () => {
  it('returns the calendar date in the given zone', () => {
    // 2026-09-20T10:00:00Z is 14:00 the same day in Yerevan (UTC+4).
    expect(todayInZone(YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('2026-09-20');
  });

  it('returns tomorrow in Yerevan when UTC is still on the previous evening', () => {
    // This is the bug the helper exists to prevent: 21:00 UTC is already 01:00
    // the next day in Yerevan, so the server clock's date is wrong by one day.
    expect(todayInZone(YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe('2026-09-21');
  });

  it('disagrees with the UTC date in that window', () => {
    const instant = new Date('2026-09-20T21:00:00Z');
    expect(todayInZone('UTC', instant)).toBe('2026-09-20');
    expect(todayInZone(YEREVAN, instant)).toBe('2026-09-21');
  });

  it('defaults to Asia/Yerevan', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Yerevan');
  });
});

describe('isOverdue', () => {
  it('is false for a task due today', () => {
    expect(isOverdue('2026-09-20', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe(false);
  });

  it('is false at 21:00 UTC for a task due on the Yerevan tomorrow', () => {
    expect(isOverdue('2026-09-21', YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe(false);
  });

  it('is true once the Yerevan day has passed', () => {
    expect(isOverdue('2026-09-20', YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe(true);
  });

  it('is true for a past date', () => {
    expect(isOverdue('2026-09-01', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe(true);
  });
});

describe('formatInZone', () => {
  it('renders an instant in the workspace zone, not UTC', () => {
    expect(formatInZone(new Date('2026-09-20T21:30:00Z'), YEREVAN)).toBe('21 Sep 2026, 01:30');
  });

  it('uses a three-letter month for September, not a four-letter one', () => {
    // Guards against a locale whose September abbreviation is "Sept", which
    // would make date columns ragged.
    expect(formatInZone(new Date('2026-09-05T10:00:00Z'), YEREVAN)).toBe('05 Sep 2026, 14:00');
  });
});

describe('formatDueDate', () => {
  it('says Today for the current day in the zone', () => {
    expect(formatDueDate('2026-09-20', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('Today');
  });

  it('says Tomorrow for the next day in the zone', () => {
    expect(formatDueDate('2026-09-21', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('Tomorrow');
  });

  it('falls back to a short date otherwise', () => {
    expect(formatDueDate('2026-10-05', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('5 Oct');
  });

  it('says Yesterday for the previous day in the zone', () => {
    expect(formatDueDate('2026-09-19', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('Yesterday');
  });

  it('appends the year for a date in a different year', () => {
    expect(formatDueDate('2027-10-05', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('5 Oct 2027');
  });
});
