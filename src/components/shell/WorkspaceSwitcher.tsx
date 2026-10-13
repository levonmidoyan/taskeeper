'use client';

import { IconCheck, IconPlus, IconSelector, IconSettings, IconUsers } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { WorkspaceTile } from '@/components/shell/WorkspaceTile';
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
      <Dropdown.Trigger className="flex h-11 w-full items-center justify-between gap-2 rounded-10 px-2.5 text-left text-label-md text-text-strong-950 transition-colors duration-150 hover:bg-bg-white-0/70 data-[state=open]:bg-bg-white-0 dark:hover:bg-bg-weak-50 dark:data-[state=open]:bg-bg-weak-50">
        <span className="flex min-w-0 items-center gap-2.5">
          <WorkspaceTile id={active?.id ?? current} name={active?.name ?? ''} logo={active?.logo ?? null} />
          <span className="truncate">{active?.name ?? 'Workspace'}</span>
        </span>
        <IconSelector className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content align="start" className="w-56">
        {workspaces.map((workspace) => (
          <Dropdown.Item key={workspace.id} onSelect={() => router.push(`/${workspace.slug}`)}>
            <Dropdown.ItemIcon
              as={IconCheck}
              className={cn(workspace.slug === current ? 'opacity-100' : 'opacity-0')}
            />
            <WorkspaceTile
              id={workspace.id}
              name={workspace.name}
              logo={workspace.logo}
              className="size-5 rounded-md text-label-xs"
            />
            <span className="truncate">{workspace.name}</span>
          </Dropdown.Item>
        ))}
        <Dropdown.Separator />
        <Dropdown.Item onSelect={() => router.push(`/${current}/settings/general`)}>
          <Dropdown.ItemIcon as={IconSettings} />
          Workspace settings
        </Dropdown.Item>
        <Dropdown.Item onSelect={() => router.push(`/${current}/settings/members`)}>
          <Dropdown.ItemIcon as={IconUsers} />
          Members
        </Dropdown.Item>
        <Dropdown.Separator />
        <Dropdown.Item onSelect={() => router.push('/new-workspace')}>
          <Dropdown.ItemIcon as={IconPlus} />
          New workspace
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
