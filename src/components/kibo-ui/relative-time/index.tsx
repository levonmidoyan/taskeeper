'use client';

/**
 * Kibo UI Relative Time — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/relative-time/index.tsx. A live clock per timezone (not "n minutes ago").
 * Adapted:
 * - The zone is always applied; upstream dropped timeZone whenever format options were
 *   passed.
 * - Ticking clock only (no controlled `time`), so plain useState replaces
 *   @radix-ui/react-use-controllable-state.
 * - Align tokens. Render it only after mount: the clock differs between server and client.
 */

import { createContext, type HTMLAttributes, useContext, useEffect, useState } from 'react';
import { cn } from '@/utils/cn';

export function formatZoneTime(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    timeZone,
  }).format(date);
}

export function formatZoneDate(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', ...options, timeZone }).format(date);
}

type RelativeTimeContextValue = {
  time: Date;
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  timeFormatOptions?: Intl.DateTimeFormatOptions;
};

const RelativeTimeContext = createContext<RelativeTimeContextValue>({ time: new Date(0) });
const RelativeTimeZoneContext = createContext<{ zone: string }>({ zone: 'UTC' });

export type RelativeTimeProps = HTMLAttributes<HTMLDivElement> & {
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  timeFormatOptions?: Intl.DateTimeFormatOptions;
};

export function RelativeTime({ dateFormatOptions, timeFormatOptions, className, ...props }: RelativeTimeProps) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <RelativeTimeContext.Provider value={{ time, dateFormatOptions, timeFormatOptions }}>
      <div className={cn('grid gap-2', className)} {...props} />
    </RelativeTimeContext.Provider>
  );
}

export function RelativeTimeZone({
  zone,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { zone: string }) {
  return (
    <RelativeTimeZoneContext.Provider value={{ zone }}>
      <div className={cn('flex items-center gap-2', className)} {...props} />
    </RelativeTimeZoneContext.Provider>
  );
}

export function RelativeTimeZoneDisplay({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { time, timeFormatOptions } = useContext(RelativeTimeContext);
  const { zone } = useContext(RelativeTimeZoneContext);
  return (
    <span className={cn('tabular text-label-sm text-text-strong-950', className)} {...props}>
      {formatZoneTime(time, zone, timeFormatOptions)}
    </span>
  );
}

export function RelativeTimeZoneDate({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { time, dateFormatOptions } = useContext(RelativeTimeContext);
  const { zone } = useContext(RelativeTimeZoneContext);
  return (
    <span className={cn('text-paragraph-xs text-text-sub-600', className)} {...props}>
      {formatZoneDate(time, zone, dateFormatOptions)}
    </span>
  );
}

export function RelativeTimeZoneLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md bg-bg-weak-50 px-1.5 font-mono text-label-2xs text-text-sub-600',
        className,
      )}
      {...props}
    />
  );
}
