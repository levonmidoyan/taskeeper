'use client';

import { IconBell, IconChecklist, IconFolders, IconPlus, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useKeyboardOpen } from '@/lib/use-keyboard-open';
import { cn } from '@/utils/cn';

const SLOT = 'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-label-xs';

/** Phone and tablet navigation (below lg): the daily loop within thumb reach. */
export function BottomBar({ workspaceSlug, unread, canCreate, onProjects, onNewTask, onSearch }: {
  workspaceSlug: string;
  unread: number;
  canCreate: boolean;
  onProjects: () => void;
  onNewTask: () => void;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const keyboard = useKeyboardOpen();
  const todo = `/${workspaceSlug}/todo`;
  const inbox = `/${workspaceSlug}/inbox`;
  const tone = (active: boolean) => (active ? 'text-primary-base' : 'text-text-sub-600');

  if (keyboard) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-stroke-soft-200 bg-bg-white-0/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <button type="button" onClick={onProjects} className={cn(SLOT, tone(false))}>
        <IconFolders className="size-5" aria-hidden="true" />
        Projects
      </button>
      <Link href={todo} aria-current={pathname === todo ? 'page' : undefined} className={cn(SLOT, tone(pathname === todo))}>
        <IconChecklist className="size-5" aria-hidden="true" />
        To-do
      </Link>
      <button type="button" onClick={onNewTask} disabled={!canCreate} aria-label="New task" className={cn(SLOT, 'disabled:opacity-40')}>
        <span className="flex size-10 items-center justify-center rounded-full bg-primary-base text-static-white shadow-regular-sm">
          <IconPlus className="size-5" aria-hidden="true" />
        </span>
      </button>
      <button type="button" onClick={onSearch} className={cn(SLOT, tone(false))}>
        <IconSearch className="size-5" aria-hidden="true" />
        Search
      </button>
      <Link href={inbox} aria-current={pathname === inbox ? 'page' : undefined} className={cn(SLOT, 'relative', tone(pathname === inbox))}>
        <IconBell className="size-5" aria-hidden="true" />
        Inbox
        {unread > 0 && (
          <span className="tabular absolute right-[calc(50%-1.25rem)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-base px-1 text-[0.625rem] font-medium text-static-white">
            {unread > 9 ? '9+' : unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </Link>
    </nav>
  );
}
