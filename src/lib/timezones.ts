// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
export const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
] as const;

/** The curated zones, plus any stored or chosen ones not among them, so a select can still show them. */
export function zoneOptions(...extra: (string | null)[]): string[] {
  const zones: string[] = [...ZONES];
  for (const zone of extra) if (zone && !zones.includes(zone)) zones.push(zone);
  return zones;
}
