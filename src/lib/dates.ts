export const DEFAULT_TIMEZONE = 'Asia/Yerevan';

/** 'YYYY-MM-DD' that is also a real calendar day — Postgres would throw on 2026-02-30. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The calendar date ('YYYY-MM-DD') in the given IANA zone at the given instant. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * A task is overdue once the workspace's calendar day has moved past its due date.
 * Compared as strings: 'YYYY-MM-DD' sorts lexicographically the same way it sorts
 * chronologically, so no Date parsing is needed and no zone can creep back in.
 */
export function isOverdue(dueDate: string, tz: string, now: Date = new Date()): boolean {
  return dueDate < todayInZone(tz, now);
}

/** Renders an instant (created_at, completed_at) in the workspace zone. */
export function formatInZone(instant: Date, tz: string): string {
  // en-US for a consistently three-letter month (en-GB renders September as
  // "Sept", which is ragged against every other month in a table column).
  // Order is assembled here rather than taken from the locale.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // Date.UTC keeps this arithmetic in a fixed zone; the result is only ever
  // formatted back out as a calendar date, never treated as an instant.
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

// Date pickers work in local Date objects, but only ever as a calendar day:
// these two helpers are the whole boundary with the YYYY-MM-DD strings.
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateToDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Human label for a due date, relative to today in the workspace zone. */
export function formatDueDate(dueDate: string, tz: string, now: Date = new Date()): string {
  const today = todayInZone(tz, now);
  if (dueDate === today) return 'Today';
  if (dueDate === addDays(today, 1)) return 'Tomorrow';
  if (dueDate === addDays(today, -1)) return 'Yesterday';

  const [y, m, d] = dueDate.split('-').map(Number);
  // Noon UTC so the date cannot slip across a boundary while being formatted.
  const asInstant = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).formatToParts(asInstant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return sameYear
    ? `${get('day')} ${get('month')}`
    : `${get('day')} ${get('month')} ${get('year')}`;
}

export type RecencyBucket = 'Today' | 'Yesterday' | 'Past week' | 'Older';

/** Groups an instant by calendar day in the workspace zone, for the Recent list. */
export function recencyBucket(instant: Date, tz: string, now: Date = new Date()): RecencyBucket {
  const day = todayInZone(tz, instant);
  const today = todayInZone(tz, now);
  if (day >= today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day >= addDays(today, -7)) return 'Past week';
  return 'Older';
}

/** Asks the runtime whether a zone exists rather than shipping a list that goes stale. */
export function isValidTimezone(tz: string): boolean {
  // Region/City names (and UTC) only. Intl also accepts raw offsets like
  // "+04:00", but Postgres reads those as POSIX zones with the sign flipped,
  // so a reminder would go out eight hours off.
  if (tz !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
