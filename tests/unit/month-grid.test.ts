import { describe, expect, it } from 'vitest';
import {
  dropTarget, monthLabel, monthWeeks, parseMonth, shiftMonth, weekdayLabels,
} from '@/components/calendar/month-grid';

describe('parseMonth', () => {
  it('takes a valid YYYY-MM', () => {
    expect(parseMonth('2026-02', '2026-10-03')).toBe('2026-02');
  });

  it.each([undefined, '', '2026-13', '2026-1', 'abc', '2026-10-01'])('falls back to today’s month for %j', (bad) => {
    expect(parseMonth(bad, '2026-10-03')).toBe('2026-10');
  });
});

describe('shiftMonth', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('monthWeeks', () => {
  it('is always 6 weeks of 7 days', () => {
    const weeks = monthWeeks('2026-02', 1);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('starts on Monday with weekStart 1 (Oct 2026 starts on a Thursday)', () => {
    const weeks = monthWeeks('2026-10', 1);
    expect(weeks[0]).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(weeks[5][6]).toBe('2026-11-08');
  });

  it('starts on Sunday with weekStart 0', () => {
    expect(monthWeeks('2026-10', 0)[0][0]).toBe('2026-09-27');
  });

  it('puts the 1st in the first row when the month starts on the week start', () => {
    // 2026-06-01 is a Monday.
    expect(monthWeeks('2026-06', 1)[0][0]).toBe('2026-06-01');
  });

  it('handles a leap February', () => {
    const days = monthWeeks('2028-02', 1).flat();
    expect(days).toContain('2028-02-29');
  });
});

describe('labels', () => {
  it('names the month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });

  it('orders weekdays from the week start', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(0)[0]).toBe('Sun');
  });
});

describe('dropTarget', () => {
  it('returns the new day', () => {
    expect(dropTarget('2026-10-03', '2026-10-05')).toBe('2026-10-05');
  });

  it('is null for the same day, no target, or a non-day target', () => {
    expect(dropTarget('2026-10-03', '2026-10-03')).toBeNull();
    expect(dropTarget('2026-10-03', null)).toBeNull();
    expect(dropTarget('2026-10-03', 'task-abc')).toBeNull();
  });
});
