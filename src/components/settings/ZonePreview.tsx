'use client';

import { useSyncExternalStore } from 'react';
import {
  RelativeTime, RelativeTimeZone, RelativeTimeZoneDisplay, RelativeTimeZoneLabel,
} from '@/components/kibo-ui/relative-time';

type LabelledZone = { label: string; zone: string };

export function previewZones(chosen: LabelledZone, localZone: string): LabelledZone[] {
  const zones = [chosen];
  if (localZone !== chosen.zone) zones.push({ label: 'Your time', zone: localZone });
  return zones;
}

/** Live clock for the chosen zone and the viewer's, so the setting's effect is visible. */
export function ZonePreview({ label, zone }: LabelledZone) {
  // The clock and the browser zone only exist on the client (spec §5.2).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return <div className="h-12" aria-hidden="true" />;

  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <RelativeTime timeFormatOptions={{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }}>
      {previewZones({ label, zone }, localZone).map(({ label, zone }) => (
        <RelativeTimeZone key={label} zone={zone}>
          <span className="w-28 text-paragraph-sm text-text-sub-600">{label}</span>
          <RelativeTimeZoneDisplay />
          <RelativeTimeZoneLabel>{zone}</RelativeTimeZoneLabel>
        </RelativeTimeZone>
      ))}
    </RelativeTime>
  );
}
