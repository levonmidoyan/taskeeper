'use client';

import {
  IconCalendar, IconCalendarFilled, IconChecklist, IconClock, IconClockFilled, IconListDetails, IconLock, IconMenu2,
  IconSparkles, IconStar, IconStarFilled,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { UserButton } from '@/components/auth/user/user-button';
import { NewProjectDialog } from '@/components/shell/NewProjectDialog';
import { ProjectColorButton } from '@/components/shell/ProjectColorPicker';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { ThemeControl } from '@/components/shell/ThemeControl';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import * as CompactButton from '@/components/ui/compact-button';
import * as Drawer from '@/components/ui/drawer';
import { ViewMenu } from '@/components/views/ViewMenu';
import { viewHref } from '@/lib/views';
import type { ProjectSummary } from '@/server/projects/queries';
import type { SavedView } from '@/server/views/queries';
import type { WorkspaceSummary } from '@/server/workspaces/queries';
import { cn } from '@/utils/cn';

type Props = {
  workspaceSlug: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  /** Owners and admins may recolor and manage projects; members see the color only. */
  canManageProjects: boolean;
  /** Workspace views (All tasks) the caller can open: their own plus shared ones. */
  views: SavedView[];
};

const navItem =
  'flex items-center gap-2 rounded-lg px-2.5 text-label-sm transition-colors duration-150';
const navIdle = 'text-text-sub-600 hover:bg-bg-white-0/70 hover:text-text-strong-950 dark:hover:bg-bg-weak-50';
const navActive =
  'bg-bg-white-0 text-text-strong-950 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 dark:bg-bg-weak-50';

function ProjectLink({
  workspaceSlug,
  project,
  active,
  canManage,
}: {
  workspaceSlug: string;
  project: ProjectSummary;
  active: boolean;
  canManage: boolean;
}) {
  // The dot and the menu are their own buttons beside the link, not inside it: a
  // button nested in an anchor is invalid and would navigate on every click.
  return (
    <div className={cn(navItem, 'group relative h-9 pl-1', active ? navActive : navIdle)}>
      <ProjectColorButton
        workspaceSlug={workspaceSlug}
        project={project}
        active={active}
        readOnly={!canManage}
        className="relative z-10"
      />
      <Link
        href={`/${workspaceSlug}/projects/${project.id}`}
        aria-current={active ? 'page' : undefined}
        // Stretched over the whole row so the gutter around the dot still navigates.
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-base"
      >
        <span className="truncate">{project.name}</span>
        {project.openTaskCount > 0 && (
          <span
            className={cn(
              'tabular ml-auto text-label-xs text-text-soft-400',
              // The menu takes the count's place while the row is hovered or focused.
              canManage && 'group-focus-within:hidden group-hover:hidden',
            )}
          >
            {project.openTaskCount}
          </span>
        )}
      </Link>
      {canManage && (
        <ProjectMenu
          workspaceSlug={workspaceSlug}
          projectId={project.id}
          name={project.name}
          placement="rail"
          // Shown on hover and focus; always on touch screens, which have no hover.
          className="relative z-10 -mr-1 hidden shrink-0 group-focus-within:flex group-hover:flex data-shown:flex pointer-coarse:flex"
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-subheading-2xs uppercase text-text-soft-400">{children}</span>;
}

function RailBody({ workspaceSlug, workspaces, projects, canManageProjects, views }: Props) {
  const params = useParams<{ projectId?: string }>();
  const pathname = usePathname();
  const openView = useSearchParams().get('view');
  const starred = projects.filter((p) => p.starred);

  const items = [
    { href: `/${workspaceSlug}`, label: 'For you', icon: IconSparkles, activeIcon: IconSparkles },
    { href: `/${workspaceSlug}/tasks`, label: 'All tasks', icon: IconListDetails, activeIcon: IconListDetails },
    { href: `/${workspaceSlug}/recent`, label: 'Recent', icon: IconClock, activeIcon: IconClockFilled },
    { href: `/${workspaceSlug}/starred`, label: 'Starred', icon: IconStar, activeIcon: IconStarFilled },
    { href: `/${workspaceSlug}/todo`, label: 'To-do', icon: IconChecklist, activeIcon: IconChecklist },
    { href: `/${workspaceSlug}/calendar`, label: 'My calendar', icon: IconCalendar, activeIcon: IconCalendarFilled },
  ];

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full w-64 flex-col gap-4 border-r border-stroke-soft-200 bg-bg-weak-25 p-3"
    >
      <WorkspaceSwitcher current={workspaceSlug} workspaces={workspaces} />

      <div className="space-y-0.5">
        {items.map(({ href, label, icon, activeIcon }) => {
          // A saved view highlights its own row below, not All tasks.
          const active = pathname === href && !openView;
          const Icon = active ? activeIcon : icon;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(navItem, 'h-9', active ? navActive : navIdle)}
            >
              <Icon className={cn('size-4 shrink-0', active ? 'text-primary-base' : 'text-text-soft-400')} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="-mx-3 flex-1 space-y-4 overflow-y-auto px-3">
        {starred.length > 0 && (
          <div className="space-y-1">
            <div className="px-2.5 py-1">
              <SectionLabel>Starred</SectionLabel>
            </div>
            {starred.map((project) => (
              <ProjectLink
                key={project.id}
                workspaceSlug={workspaceSlug}
                project={project}
                active={params.projectId === project.id}
                canManage={canManageProjects}
              />
            ))}
          </div>
        )}

        {views.length > 0 && (
          <div className="space-y-1">
            <div className="px-2.5 py-1"><SectionLabel>Views</SectionLabel></div>
            {views.map((view) => {
              const active = openView === view.id;
              const Icon = view.layout === 'calendar' ? IconCalendar : IconListDetails;
              return (
                <div key={view.id} className={cn(navItem, 'group relative h-9', active ? navActive : navIdle)}>
                  <Link
                    href={viewHref(workspaceSlug, view)}
                    aria-current={active ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 self-stretch after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-base"
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-primary-base' : 'text-text-soft-400')} aria-hidden="true" />
                    <span className="truncate">{view.name}</span>
                    {!view.shared && <IconLock className="size-3.5 shrink-0 text-text-soft-400" aria-label="Private" />}
                  </Link>
                  <ViewMenu
                    workspaceSlug={workspaceSlug}
                    view={view}
                    placement="rail"
                    className="relative z-10 -mr-1 hidden shrink-0 group-focus-within:flex group-hover:flex data-shown:flex pointer-coarse:flex"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between px-2.5 py-1">
            <SectionLabel>Projects</SectionLabel>
            <NewProjectDialog workspaceSlug={workspaceSlug} />
          </div>

          {projects.length === 0 ? (
            <p className="px-2.5 py-3 text-paragraph-sm text-text-sub-600">
              No projects yet. Create one to get started.
            </p>
          ) : (
            projects.map((project) => (
              <ProjectLink
                key={project.id}
                workspaceSlug={workspaceSlug}
                project={project}
                active={params.projectId === project.id}
                canManage={canManageProjects}
              />
            ))
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-stroke-soft-200 pt-3">
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

export type RailProps = Props;

/** Desktop rail. Below lg the same body lives in MobileNav's drawer, opened from the app header. */
export function Rail(props: Props) {
  return (
    // Sticky at viewport height, so the rail stays put while long pages scroll
    // and the project list scrolls inside it instead.
    <aside className="sticky top-0 hidden h-dvh shrink-0 self-start lg:block">
      <RailBody {...props} />
    </aside>
  );
}

export function MobileNav(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <CompactButton.Root
          variant="ghost"
          size="large"
          aria-label="Open navigation"
          className="size-10 shrink-0 lg:hidden"
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
  );
}
