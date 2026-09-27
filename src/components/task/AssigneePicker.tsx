'use client';

import { IconCheck, IconChevronDown, IconSearch, IconUserOff } from '@tabler/icons-react';
import { Command } from 'cmdk';
import { useState } from 'react';
import { UserAvatar } from '@/components/task/AssigneeAvatar';
import * as Popover from '@/components/ui/popover';
import { selectVariants } from '@/components/ui/select';
import type { MemberRow } from '@/server/labels/queries';
import { cn } from '@/utils/cn';

const { triggerRoot, triggerArrow } = selectVariants({ size: 'medium' });

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-paragraph-sm text-text-strong-950 data-[selected=true]:bg-bg-weak-50';

/**
 * Searchable member picker: filters by name or email, shows each member's
 * avatar. `null` is Unassigned.
 */
export function AssigneePicker({
  id,
  members,
  value,
  onChange,
}: {
  id?: string;
  members: MemberRow[];
  value: string | null;
  onChange: (userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = members.find((m) => m.userId === value) ?? null;

  function pick(userId: string | null) {
    setOpen(false);
    if (userId !== value) onChange(userId);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger id={id} className={triggerRoot()}>
        {selected ? (
          <>
            <UserAvatar name={selected.name} image={selected.image} size="20" aria-hidden="true" />
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          <>
            <IconUserOff className="size-5 shrink-0 text-text-soft-400" aria-hidden="true" />
            <span className="text-text-sub-600">Unassigned</span>
          </>
        )}
        <IconChevronDown className={triggerArrow()} aria-hidden="true" />
      </Popover.Trigger>

      <Popover.Content
        align="start"
        sideOffset={8}
        showArrow={false}
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command label="Assignee">
          <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-3">
            <IconSearch className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
            <Command.Input
              placeholder="Search members…"
              className="h-10 w-full bg-transparent text-paragraph-sm text-text-strong-950 outline-none placeholder:text-text-soft-400"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="p-3 text-paragraph-sm text-text-sub-600">No members found</Command.Empty>
            <Command.Item value="Unassigned" onSelect={() => pick(null)} className={itemClass}>
              <IconUserOff className="size-5 shrink-0 text-text-soft-400" aria-hidden="true" />
              <span className="flex-1 text-text-sub-600">Unassigned</span>
              <IconCheck className={cn('size-4', value === null ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
            </Command.Item>
            {members.map((m) => (
              <Command.Item
                key={m.userId}
                // Name and email are both searchable; email keeps the value unique.
                value={`${m.name} ${m.email}`}
                onSelect={() => pick(m.userId)}
                className={itemClass}
              >
                <UserAvatar name={m.name} image={m.image} size="20" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.name}</span>
                  <span className="block truncate text-paragraph-xs text-text-sub-600">{m.email}</span>
                </span>
                <IconCheck
                  className={cn('size-4 shrink-0', m.userId === value ? 'opacity-100' : 'opacity-0')}
                  aria-hidden="true"
                />
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Popover.Content>
    </Popover.Root>
  );
}
