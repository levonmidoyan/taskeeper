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
  const ref = React.useRef<HTMLImageElement>(null);

  // A server-rendered or cached image can finish loading before React attaches
  // onLoad, which then never fires; read the element's own state instead.
  React.useEffect(() => {
    const img = ref.current;
    setLoaded(!!img && img.complete && img.naturalWidth > 0);
  }, [src, setLoaded]);

  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- user avatars come from arbitrary origins
    <img
      ref={ref}
      src={src}
      alt={alt}
      // Google profile photos (lh3.googleusercontent.com) answer a request that
      // carries the app's Referer with an error page, which the browser blocks.
      referrerPolicy="no-referrer"
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
