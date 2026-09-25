'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/legacy-ui/dropdown-menu';
import type { WorkspaceSummary } from '@/server/workspaces/queries';

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: WorkspaceSummary[];
}) {
  const router = useRouter();
  const active = workspaces.find((w) => w.slug === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full items-center justify-between rounded-[var(--radius-button)] px-2 text-left text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-muted">
        <span className="truncate">{active?.name ?? 'Workspace'}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => router.push(`/${workspace.slug}`)}
          >
            <Check
              className={`size-4 ${workspace.slug === current ? 'opacity-100' : 'opacity-0'}`}
              aria-hidden="true"
            />
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/new-workspace')}>
          <Plus className="size-4" aria-hidden="true" />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
