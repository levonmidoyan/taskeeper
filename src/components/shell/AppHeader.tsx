'use client';

import { CreateTaskDialog } from '@/components/shell/CreateTaskDialog';
import { MobileNav, type RailProps } from '@/components/shell/Rail';
import { TaskSearch } from '@/components/shell/TaskSearch';

/**
 * Top bar of the content column, on every workspace and account page. It owns
 * the mobile nav trigger, so pages no longer pad their left edge to clear a
 * floating button.
 */
export function AppHeader(props: RailProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stroke-soft-200 bg-bg-white-0/85 px-3 backdrop-blur-md lg:gap-3 lg:px-6">
      <MobileNav {...props} />
      <div className="flex min-w-0 flex-1 justify-center">
        <TaskSearch workspaceSlug={props.workspaceSlug} projects={props.projects} />
      </div>
      <CreateTaskDialog workspaceSlug={props.workspaceSlug} projects={props.projects} />
    </header>
  );
}
