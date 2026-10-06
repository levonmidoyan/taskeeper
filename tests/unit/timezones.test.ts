import { describe, expect, it } from 'vitest';
import { ZONES, zoneOptions } from '@/lib/timezones';

describe('zoneOptions', () => {
  it('is the curated list when nothing is stored', () => {
    expect(zoneOptions(null)).toEqual([...ZONES]);
  });

  it('does not duplicate a stored zone that is already listed', () => {
    expect(zoneOptions('UTC')).toEqual([...ZONES]);
  });

  it('appends a stored zone the list does not have, so the select can still show it', () => {
    expect(zoneOptions('Australia/Sydney')).toEqual([...ZONES, 'Australia/Sydney']);
  });

  it('keeps both a saved and a newly chosen off-list zone', () => {
    expect(zoneOptions('Australia/Sydney', 'Asia/Kolkata')).toEqual([...ZONES, 'Australia/Sydney', 'Asia/Kolkata']);
    expect(zoneOptions('Australia/Sydney', null)).toEqual([...ZONES, 'Australia/Sydney']);
    expect(zoneOptions('Asia/Kolkata', 'Asia/Kolkata')).toEqual([...ZONES, 'Asia/Kolkata']);
  });
});
