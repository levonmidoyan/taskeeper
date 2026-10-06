'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isBusy, subscribeBusy } from '@/lib/live/busy';
import { createRefresher, type Refresher } from '@/lib/live/refresher';
import { createPollingTransport } from '@/lib/live/transport';

/**
 * Keeps workspace pages current while teammates edit: when the workspace's
 * change counter passes `version` (what this render was built from), refresh
 * the server components once the user is idle. Renders nothing. The private
 * Todo page opts out: only its owner edits it.
 */
export function LiveRefresh({ slug, version }: { slug: string; version: number }) {
  const router = useRouter();
  const paused = usePathname().endsWith('/todo');
  const seen = useRef(version);
  const refresher = useRef<Refresher | null>(null);

  useEffect(() => {
    seen.current = version;
    refresher.current?.setSeen(version);
  }, [version]);

  useEffect(() => {
    if (paused) return;
    const r = createRefresher({ seen: seen.current, isBusy, refresh: () => router.refresh() });
    refresher.current = r;
    const unsubscribeBusy = subscribeBusy(r.recheck);
    const unsubscribeChanges = createPollingTransport(slug).subscribe(r.onVersion);
    return () => {
      unsubscribeChanges();
      unsubscribeBusy();
      refresher.current = null;
    };
  }, [slug, paused, router]);

  return null;
}
