import { describe, expect, it } from 'vitest';
import { formatZoneTime } from '@/components/kibo-ui/relative-time';
import { previewZones } from '@/components/settings/ZonePreview';

const noonUtc = new Date('2026-01-15T12:00:00Z');

describe('formatZoneTime', () => {
  it('applies the zone even when format options are passed', () => {
    // Upstream Kibo only set timeZone when options were omitted, so every custom
    // format showed the browser's clock instead of the zone's.
    expect(formatZoneTime(noonUtc, 'Asia/Yerevan', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
      .toBe('16:00');
    expect(formatZoneTime(noonUtc, 'America/New_York', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
      .toBe('07:00');
  });
});

describe('previewZones', () => {
  it('shows the workspace and the viewer zone', () => {
    expect(previewZones('Europe/Berlin', 'Asia/Yerevan')).toEqual([
      { label: 'Workspace time', zone: 'Europe/Berlin' },
      { label: 'Your time', zone: 'Asia/Yerevan' },
    ]);
  });

  it('shows one line when they are the same', () => {
    expect(previewZones('UTC', 'UTC')).toEqual([{ label: 'Workspace time', zone: 'UTC' }]);
  });
});
