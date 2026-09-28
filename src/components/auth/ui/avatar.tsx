'use client';

import * as React from 'react';
import { cn } from '@/utils/cn';

// Radix's Avatar semantics on plain elements: the image shows once it has loaded,
// the fallback shows until then, when there is no src, and when the image fails.
const AvatarContext = React.createContext<{
  loaded: boolean;
  setLoaded: (loaded: boolean) => void;
}>({ loaded: false, setLoaded: () => {} });

export function Avatar({ className, ...props }: React.ComponentProps<'span'>) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <AvatarContext.Provider value={{ loaded, setLoaded }}>
      <span
        className={cn(
          'relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
          'bg-bg-soft-200 text-label-xs uppercase text-text-sub-600',
          className,
        )}
        {...props}
      />
    </AvatarContext.Provider>
  );
}

export function AvatarImage({ className, src, alt = '', ...props }: React.ComponentProps<'img'>) {
  const { loaded, setLoaded } = React.useContext(AvatarContext);

  React.useEffect(() => setLoaded(false), [src, setLoaded]);

  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- user avatars come from arbitrary origins
    <img
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(false)}
      className={cn('absolute inset-0 size-full object-cover', !loaded && 'invisible', className)}
      {...props}
    />
  );
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<'span'>) {
  const { loaded } = React.useContext(AvatarContext);
  if (loaded) return null;
  return <span className={cn('flex size-full items-center justify-center', className)} {...props} />;
}
