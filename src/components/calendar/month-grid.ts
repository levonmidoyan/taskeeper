import { addDays, isCalendarDay } from '@/lib/dates';

/*
 * Calendar math on 'YYYY-MM' and 'YYYY-MM-DD' strings only. Due dates are
 * calendar days, not instants, so nothing here builds a local Date to compare.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/*
 * Years the calendar shows. Date.UTC reads years 0–99 as 1900–1999, and the
 * grid of December 9999 runs into year 10000, which toISOString writes as
 * '+010000-…' and no day parses back from. Both stay well outside this range.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

/** True for a 'YYYY-MM' the calendar can show. */
export function isShownMonth(month: string): boolean {
  const match = MONTH.exec(month);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

export function parseMonth(param: string | undefined, today: string): string {
  return param && isShownMonth(param) ? param : today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Day of week (0 = Sunday) of a calendar day; UTC so no zone can shift it. */
function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Six weeks covering the month, starting on the week-start day on or before the 1st. */
export function monthWeeks(month: string, weekStart: number): string[][] {
  const first = `${month}-01`;
  const lead = (weekday(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Spoken name of a day cell, e.g. 'Monday, October 5, 2026'. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function weekdayLabels(weekStart: number): string[] {
  const format = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2026, 9, 4 + ((weekStart + i) % 7)))),
  );
}

/** The day a drop should save, or null: same day, released outside, or not on a day cell. */
export function dropTarget(fromDay: string | null, overId: string | null): string | null {
  if (!overId || !isCalendarDay(overId) || overId === fromDay) return null;
  return overId;
}
