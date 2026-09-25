'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Menu, Settings } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/legacy-ui/sheet';
import { ThemeControl } from '@/components/shell/ThemeControl';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { NewProjectDialog } from '@/components/shell/NewProjectDialog';
import type { ProjectSummary } from '@/server/projects/queries';
import type { WorkspaceSummary } from '@/server/workspaces/queries';

type Props = {
  workspaceSlug: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  userName: string;
};

function RailBody({ workspaceSlug, workspaces, projects }: Props) {
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full w-64 flex-col gap-4 border-r border-border bg-card p-3"
    >
      <WorkspaceSwitcher current={workspaceSlug} workspaces={workspaces} />

      <div className="flex-1 space-y-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Projects
          </span>
          <NewProjectDialog workspaceSlug={workspaceSlug} />
        </div>

        {projects.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
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
                className={`flex items-center gap-2 rounded-[var(--radius-button)] border-l-2 px-2 py-2 text-sm transition-colors duration-150 ${
                  active
                    ? 'border-l-primary bg-muted font-semibold text-foreground'
                    : 'border-l-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span className="truncate">{project.name}</span>
                {project.openTaskCount > 0 && (
                  <span className="tabular ml-auto text-xs text-muted-foreground">
                    {project.openTaskCount}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>

      <div className="space-y-1 border-t border-border pt-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/${workspaceSlug}/settings/members`}
            aria-current={pathname.endsWith('/settings/members') ? 'page' : undefined}
            className="flex h-11 flex-1 items-center gap-2 rounded-[var(--radius-button)] px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-4" aria-hidden="true" />
            Settings
          </Link>
          <ThemeControl />
        </div>
        <Link
          href={`/${workspaceSlug}/settings/general`}
          aria-current={pathname.endsWith('/settings/general') ? 'page' : undefined}
          className="flex h-11 items-center gap-2 rounded-[var(--radius-button)] px-2 pl-8 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          General
        </Link>
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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open navigation"
          className="fixed left-3 top-3 z-40 inline-flex size-11 items-center justify-center rounded-[var(--radius-button)] border border-border bg-card text-foreground lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <RailBody {...props} />
        </SheetContent>
      </Sheet>
    </>
  );
}
