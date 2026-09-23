export const DEFAULT_TIMEZONE = 'Asia/Yerevan';

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

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // Date.UTC keeps this arithmetic in a fixed zone; the result is only ever
  // formatted back out as a calendar date, never treated as an instant.
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
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
