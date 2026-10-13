'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { type ReactNode, ViewTransition } from 'react';
import { VIEW_SWITCH_CLASSES, viewSwitchKey } from '@/lib/motion';

/**
 * A project view, slid sideways when a view tab is picked (the project layout).
 * Keyed by route and saved view, so a filter or ?task change updates in place,
 * and only view-switch navigations (ViewTabs) animate.
 */
export function ViewSwitchTransition({ className, children }: { className?: string; children: ReactNode }) {
  const key = viewSwitchKey(usePathname(), useSearchParams().get('view'));
  return (
    <ViewTransition key={key} {...VIEW_SWITCH_CLASSES}>
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}
