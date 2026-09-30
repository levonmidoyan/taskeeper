'use client';

import { viewPaths } from '@better-auth-ui/core';
import { usePathname } from 'next/navigation';
import { homeCrumb } from '@/components/shell/crumbs';
import { PageBreadcrumb } from '@/components/shell/PageBreadcrumb';

const tabLabels: Record<string, string> = {
  [viewPaths.settings.account]: 'Profile',
  [viewPaths.settings.security]: 'Security',
};

/** Account settings share one layout, so the current tab comes from the URL. */
export function AccountBreadcrumb({ workspaceSlug, className }: { workspaceSlug: string; className?: string }) {
  const tab = usePathname().split('/').pop() ?? '';

  return (
    <PageBreadcrumb
      className={className}
      items={[
        homeCrumb(workspaceSlug),
        { label: 'Account', href: '/settings' },
        { label: tabLabels[tab] ?? 'Settings' },
      ]}
    />
  );
}
