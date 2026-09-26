'use client';

import { IconMenu2, IconSettings } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { UserButton } from '@/components/auth/user/user-button';
import { NewProjectDialog } from '@/components/shell/NewProjectDialog';
import { ThemeControl } from '@/components/shell/ThemeControl';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import * as CompactButton from '@/components/ui/compact-button';
import * as Drawer from '@/components/ui/drawer';
import type { ProjectSummary } from '@/server/projects/queries';
import type { WorkspaceSummary } from '@/server/workspaces/queries';
import { cn } from '@/utils/cn';

type Props = {
  workspaceSlug: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  userName: string;
};

const navItem =
  'flex items-center gap-2 rounded-lg px-2.5 text-label-sm transition-colors duration-150';
const navIdle = 'text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950';
const navActive = 'bg-bg-weak-50 text-text-strong-950';

function RailBody({ workspaceSlug, workspaces, projects }: Props) {
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  const onMembers = pathname.endsWith('/settings/members');
  const onGeneral = pathname.endsWith('/settings/general');

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full w-64 flex-col gap-4 border-r border-stroke-soft-200 bg-bg-white-0 p-3"
    >
      <WorkspaceSwitcher current={workspaceSlug} workspaces={workspaces} />

      <div className="flex-1 space-y-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-subheading-2xs uppercase text-text-soft-400">Projects</span>
          <NewProjectDialog workspaceSlug={workspaceSlug} />
        </div>

        {projects.length === 0 ? (
          <p className="px-2.5 py-3 text-paragraph-sm text-text-sub-600">
            No projects yet. Create one to get started.
          </p>
        ) : (
          projects.map((project) => {
            const active = params.projectId === project.id;
            return (
              <Link
                key={project.id}
                href={`/${workspaceSlug}/projects/${project.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(navItem, 'h-9', active ? navActive : navIdle)}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-primary-base' : 'bg-bg-soft-200')}
                />
                <span className="truncate">{project.name}</span>
                {project.openTaskCount > 0 && (
                  <span className="tabular ml-auto text-label-xs text-text-soft-400">
                    {project.openTaskCount}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>

      <div className="space-y-1 border-t border-stroke-soft-200 pt-3">
        <Link
          href={`/${workspaceSlug}/settings/members`}
          aria-current={onMembers ? 'page' : undefined}
          className={cn(navItem, 'h-10', onMembers ? navActive : navIdle)}
        >
          <IconSettings className="size-5" aria-hidden="true" />
          Settings
        </Link>
        <Link
          href={`/${workspaceSlug}/settings/general`}
          aria-current={onGeneral ? 'page' : undefined}
          className={cn(navItem, 'h-10 pl-9', onGeneral ? navActive : navIdle)}
        >
          General
        </Link>
        <div className="flex items-center justify-between px-2.5 pt-2">
          <span className="text-paragraph-xs text-text-soft-400">Theme</span>
          <ThemeControl />
        </div>
        {/* No account settings screen yet, so the built-in Settings link would dead-end. */}
        <UserButton side="top" align="start" className="mt-2 w-full justify-start px-2.5" />
      </div>
    </nav>
  );
}

export function Rail(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="hidden lg:block">
        <RailBody {...props} />
      </aside>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger asChild>
          <CompactButton.Root
            variant="stroke"
            size="large"
            aria-label="Open navigation"
            className="fixed left-3 top-3 z-40 size-11 lg:hidden"
          >
            <CompactButton.Icon as={IconMenu2} />
          </CompactButton.Root>
        </Drawer.Trigger>
        <Drawer.Content side="left" aria-describedby={undefined} className="max-w-64">
          <Drawer.Title className="sr-only">Workspace navigation</Drawer.Title>
          {/* Navigating closes the drawer: the pathname changes, and a click on any link
              inside bubbles here first. */}
          <div className="h-full" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
            <RailBody {...props} />
          </div>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
