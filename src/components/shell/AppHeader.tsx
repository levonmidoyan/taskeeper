'use client';

import { useState } from 'react';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { CreateTaskDialog } from '@/components/shell/CreateTaskDialog';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { MobileNav, type RailProps } from '@/components/shell/Rail';

/**
 * Top bar of the content column, on every workspace and account page. It owns
 * the mobile nav trigger, so pages no longer pad their left edge to clear a
 * floating button, and the create dialog's open state, which the command
 * palette's "New task" also drives.
 */
export function AppHeader({ unread, ...props }: RailProps & { unread: number }) {
  const [creating, setCreating] = useState(false);
  const canCreate = props.projects.length > 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-stroke-soft-200 bg-bg-white-0/85 px-3 backdrop-blur-md lg:gap-3 lg:px-6">
      <MobileNav {...props} />
      <div className="flex min-w-0 flex-1 justify-center max-sm:justify-end">
        <CommandPalette
          workspaceSlug={props.workspaceSlug}
          projects={props.projects}
          onNewTask={() => { if (canCreate) setCreating(true); }}
        />
      </div>
      <NotificationBell workspaceSlug={props.workspaceSlug} initialUnread={unread} />
      <CreateTaskDialog
        workspaceSlug={props.workspaceSlug}
        projects={props.projects}
        open={creating}
        onOpenChange={setCreating}
      />
    </header>
  );
}
