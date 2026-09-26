'use client';

import { useEffect } from 'react';
import { LAST_WORKSPACE_COOKIE } from '@/lib/last-workspace';

/** Records the open workspace so /settings can show the same rail. Only a hint: the reader re-checks membership. */
export function RememberWorkspace({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);

  return null;
}
