'use client';

import { IconArrowUpRight, IconDots, IconLink, IconTrash } from '@tabler/icons-react';
import { toast } from 'sonner';
import { FIELD_LABEL, TaskFieldItems, type TaskField, type TaskPatch } from '@/components/task/TaskFieldItems';
import * as Dropdown from '@/components/ui/dropdown';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow } from '@/server/tasks/queries';

const FIELDS: TaskField[] = ['status', 'priority', 'due'];

/** The "⋯" menu at the end of a list row: the one-task version of the bulk bar. */
export function TaskRowActions({
  task,
  statuses,
  timezone,
  disabled,
  onOpen,
  onPatch,
  onDelete,
}: {
  task: TaskRow;
  statuses: StatusRow[];
  timezone: string;
  disabled?: boolean;
  onOpen: () => void;
  onPatch: (patch: TaskPatch) => void;
  onDelete: () => void;
}) {
  function copyLink() {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('task', task.id);
    navigator.clipboard.writeText(url.toString()).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link.'),
    );
  }

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        disabled={disabled}
        aria-label={`Actions for ${task.title}`}
        // The row itself opens the task; the menu must not.
        onClick={(e) => e.stopPropagation()}
        className="flex size-7 items-center justify-center rounded-md text-text-soft-400 opacity-0 transition duration-150 hover:bg-bg-soft-200 hover:text-text-strong-950 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:bg-bg-soft-200 data-[state=open]:text-text-strong-950 data-[state=open]:opacity-100"
      >
        <IconDots className="size-4" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <Dropdown.Item onSelect={onOpen}>
          <Dropdown.ItemIcon as={IconArrowUpRight} />
          Open
        </Dropdown.Item>
        <Dropdown.Item onSelect={copyLink}>
          <Dropdown.ItemIcon as={IconLink} />
          Copy link
        </Dropdown.Item>
        <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
        {FIELDS.map((field) => (
          <Dropdown.MenuSub key={field}>
            <Dropdown.MenuSubTrigger>{FIELD_LABEL[field]}</Dropdown.MenuSubTrigger>
            <Dropdown.Portal>
              <Dropdown.MenuSubContent sideOffset={6} className="max-h-80 min-w-48 overflow-y-auto">
                <TaskFieldItems
                  field={field}
                  statuses={statuses}
                  timezone={timezone}
                  onPick={onPatch}
                />
              </Dropdown.MenuSubContent>
            </Dropdown.Portal>
          </Dropdown.MenuSub>
        ))}
        <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
        <Dropdown.Item onSelect={onDelete} className="text-error-base">
          <Dropdown.ItemIcon as={IconTrash} className="text-error-base" />
          Delete
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
