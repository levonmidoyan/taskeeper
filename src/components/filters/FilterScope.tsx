'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useOptimistic, useTransition } from 'react';
import { FILTER_PARAM_KEYS, filterToParams, type TaskFilter } from '@/lib/task-filter';
import { cn } from '@/utils/cn';

type FilterNav = {
  /** The filter being shown: the URL's, or one just applied whose navigation hasn't landed yet. */
  filter: TaskFilter;
  pending: boolean;
  apply: (filter: TaskFilter) => void;
};
const Ctx = createContext<FilterNav | null>(null);

/**
 * Owns the transition that filter changes run in, so the bar can show it is
 * working and the results under it can dim while the server re-renders. The
 * applied filter shows at once, so a second change made before the first one's
 * render lands builds on it instead of on the stale URL.
 */
export function FilterScope({ filter, children }: { filter: TaskFilter; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(filter);

  // Stable between renders, so FilterBar's debounce timer isn't reset by unrelated ones.
  const apply = useCallback(
    (nextFilter: TaskFilter) => {
      const next = new URLSearchParams(searchParams);
      for (const key of FILTER_PARAM_KEYS) next.delete(key);
      // A new filter changes every page; back to the first.
      next.delete('page');
      for (const [k, v] of filterToParams(nextFilter)) next.set(k, v);
      // replace: refining a filter is not a step worth walking back through, like sort.
      startTransition(() => {
        setOptimistic(nextFilter);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [router, pathname, searchParams, setOptimistic],
  );

  return <Ctx.Provider value={{ filter: optimistic, pending, apply }}>{children}</Ctx.Provider>;
}

export function useFilterNav(): FilterNav {
  const nav = useContext(Ctx);
  if (!nav) throw new Error('useFilterNav must be used inside <FilterScope>.');
  return nav;
}

export function FilterResults({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFilterNav();
  return (
    <div aria-busy={pending || undefined} className={cn('transition-opacity duration-150', pending && 'opacity-60', className)}>
      {children}
    </div>
  );
}
