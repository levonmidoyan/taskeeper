'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

/** A ?view= the caller can't open: say so once and drop it from the URL. */
export function ViewNotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    toast.error('View not found', { id: 'view-not-found', description: 'It may have been deleted or made private.' });
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  return null;
}
