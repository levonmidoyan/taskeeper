'use client';

import { viewPaths } from '@better-auth-ui/core';
import {
  IconAdjustmentsHorizontal,
  IconChevronRight,
  IconClock,
  IconFolders,
  IconShield,
  IconUser,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import * as TabMenu from '@/components/ui/tab-menu-vertical';

type SettingsTab = { label: string; href: string; icon: Icon };

/**
 * Side menu for settings pages that live on their own routes. The active tab
 * comes from the URL and picking one navigates, so the page itself is the panel.
 */
function SettingsTabs({
  tabs,
  label,
  children,
}: {
  tabs: SettingsTab[];
  label: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = tabs.find((tab) => pathname.startsWith(tab.href))?.href ?? '';

  return (
    <TabMenu.Root
      value={current}
      onValueChange={(href) => router.push(href)}
      // Arrow keys only move focus; navigating on focus would load every page passed over.
      activationMode="manual"
      className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8"
    >
      <TabMenu.List aria-label={label} className="shrink-0 md:sticky md:top-6 md:w-56">
        {tabs.map((tab) => (
          <TabMenu.Trigger key={tab.href} value={tab.href}>
            <TabMenu.Icon as={tab.icon} aria-hidden="true" />
            {tab.label}
            <TabMenu.ArrowIcon as={IconChevronRight} aria-hidden="true" />
          </TabMenu.Trigger>
        ))}
      </TabMenu.List>

      {current ? (
        <TabMenu.Content value={current} tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </TabMenu.Content>
      ) : (
        <div className="min-w-0 flex-1">{children}</div>
      )}
    </TabMenu.Root>
  );
}

export function AccountSettingsTabs({ children }: { children: React.ReactNode }) {
  return (
    <SettingsTabs
      label="Account settings"
      tabs={[
        { label: 'Profile', href: `/settings/${viewPaths.settings.account}`, icon: IconUser },
        { label: 'Security', href: `/settings/${viewPaths.settings.security}`, icon: IconShield },
        { label: 'Preferences', href: '/settings/preferences', icon: IconClock },
      ]}
    >
      {children}
    </SettingsTabs>
  );
}

export function WorkspaceSettingsTabs({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsTabs
      label="Workspace settings"
      tabs={[
        { label: 'General', href: `/${workspaceSlug}/settings/general`, icon: IconAdjustmentsHorizontal },
        { label: 'Members', href: `/${workspaceSlug}/settings/members`, icon: IconUsers },
        { label: 'Projects', href: `/${workspaceSlug}/settings/projects`, icon: IconFolders },
      ]}
    >
      {children}
    </SettingsTabs>
  );
}
