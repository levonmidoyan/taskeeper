'use client';

import { useState } from 'react';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { CreateTaskDialog } from '@/components/shell/CreateTaskDialog';
import { GoToShortcuts } from '@/components/shell/GoToShortcuts';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { MobileNav, type RailProps } from '@/components/shell/Rail';
import { ShortcutHelpDialog } from '@/components/shell/ShortcutHelpDialog';
import { TaskNavShortcuts } from '@/components/shell/TaskNavShortcuts';
import { useShortcut } from '@/lib/shortcuts/provider';

/**
 * Top bar of the content column, on every workspace and account page. It owns
 * the mobile nav trigger, so pages no longer pad their left edge to clear a
 * floating button, the create dialog's open state, which the command
 * palette's "New task" also drives, and the keyboard shortcuts overlay's,
 * which "?" and the palette's "Keyboard shortcuts" open.
 */
export function AppHeader({ unread, serverNow, sound, ...props }: RailProps & {
  unread: number;
  serverNow: number;
  sound: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const canCreate = props.projects.length > 0;
  const [showingShortcuts, setShowingShortcuts] = useState(false);
  useShortcut('general.help', () => setShowingShortcuts(true));

  return (
    <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] gap-2 border-b border-stroke-soft-200 bg-bg-white-0/85 px-3 backdrop-blur-md lg:gap-3 lg:px-6">
      <MobileNav {...props} />
      <div className="flex min-w-0 flex-1 justify-center max-sm:justify-end">
        <CommandPalette
          workspaceSlug={props.workspaceSlug}
          projects={props.projects}
          onNewTask={() => { if (canCreate) setCreating(true); }}
          onShowShortcuts={() => setShowingShortcuts(true)}
        />
      </div>
      <NotificationBell workspaceSlug={props.workspaceSlug} initialUnread={unread} serverNow={serverNow} sound={sound} />
      <CreateTaskDialog
        workspaceSlug={props.workspaceSlug}
        projects={props.projects}
        open={creating}
        onOpenChange={setCreating}
      />
      <TaskNavShortcuts />
      <GoToShortcuts workspaceSlug={props.workspaceSlug} />
      <ShortcutHelpDialog open={showingShortcuts} onOpenChange={setShowingShortcuts} />
    </header>
  );
}
