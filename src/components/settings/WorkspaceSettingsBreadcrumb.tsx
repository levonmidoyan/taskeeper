'use client';

import { usePathname } from 'next/navigation';
import { workspaceSettingsCrumbs } from '@/components/shell/crumbs';
import { PageBreadcrumb } from '@/components/shell/PageBreadcrumb';

const tabLabels: Record<string, string> = {
  general: 'General',
  members: 'Members',
};

/** Workspace settings share one layout, so the current tab comes from the URL. */
export function WorkspaceSettingsBreadcrumb({
  workspaceSlug,
  className,
}: {
  workspaceSlug: string;
  className?: string;
}) {
  const tab = usePathname().split('/').pop() ?? '';

  return (
    <PageBreadcrumb className={className} items={workspaceSettingsCrumbs(workspaceSlug, tabLabels[tab] ?? 'Settings')} />
  );
}
