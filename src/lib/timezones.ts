// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
export const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
] as const;

/** The curated zones, plus the stored one if it is not among them, so a select can still show it. */
export function zoneOptions(stored: string | null): string[] {
  const zones: string[] = [...ZONES];
  if (stored && !zones.includes(stored)) zones.push(stored);
  return zones;
}
