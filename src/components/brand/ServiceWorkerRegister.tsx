'use client';

import { useEffect } from 'react';

/** Registers /sw.js once per load. Production only: under next dev a worker would get in the way of hot reload. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((error) => {
      console.error('Service worker registration failed', error);
    });
  }, []);
  return null;
}
