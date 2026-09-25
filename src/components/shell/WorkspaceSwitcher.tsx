'use client';

import { IconCheck, IconPlus, IconSelector } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import * as Dropdown from '@/components/ui/dropdown';
import type { WorkspaceSummary } from '@/server/workspaces/queries';
import { cn } from '@/utils/cn';

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
    <Dropdown.Root>
      <Dropdown.Trigger className="flex h-11 w-full items-center justify-between gap-2 rounded-10 px-2.5 text-left text-label-md text-text-strong-950 transition-colors duration-150 hover:bg-bg-weak-50 data-[state=open]:bg-bg-weak-50">
        <span className="truncate">{active?.name ?? 'Workspace'}</span>
        <IconSelector className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content align="start" className="w-56">
        {workspaces.map((workspace) => (
          <Dropdown.Item key={workspace.id} onSelect={() => router.push(`/${workspace.slug}`)}>
            <Dropdown.ItemIcon
              as={IconCheck}
              className={cn(workspace.slug === current ? 'opacity-100' : 'opacity-0')}
            />
            <span className="truncate">{workspace.name}</span>
          </Dropdown.Item>
        ))}
        <Dropdown.Separator />
        <Dropdown.Item onSelect={() => router.push('/new-workspace')}>
          <Dropdown.ItemIcon as={IconPlus} />
          New workspace
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
