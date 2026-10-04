'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useTransition } from 'react';
import { FILTER_PARAM_KEYS, filterToParams, type TaskFilter } from '@/lib/task-filter';
import { cn } from '@/utils/cn';

type FilterNav = { pending: boolean; apply: (filter: TaskFilter) => void };
const Ctx = createContext<FilterNav | null>(null);

/**
 * Owns the transition that filter changes run in, so the bar can show it is
 * working and the results under it can dim while the server re-renders.
 */
export function FilterScope({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Stable between renders, so FilterBar's debounce timer isn't reset by unrelated ones.
  const apply = useCallback(
    (filter: TaskFilter) => {
      const next = new URLSearchParams(searchParams);
      for (const key of FILTER_PARAM_KEYS) next.delete(key);
      // A new filter changes every page; back to the first.
      next.delete('page');
      for (const [k, v] of filterToParams(filter)) next.set(k, v);
      // replace: refining a filter is not a step worth walking back through, like sort.
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [router, pathname, searchParams],
  );

  return <Ctx.Provider value={{ pending, apply }}>{children}</Ctx.Provider>;
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
