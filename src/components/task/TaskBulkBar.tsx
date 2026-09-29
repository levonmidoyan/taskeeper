'use client';

import { IconChevronDown, IconTrash, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { FIELD_LABEL, TaskFieldItems, type TaskField, type TaskPatch } from '@/components/task/TaskFieldItems';
import * as Dropdown from '@/components/ui/dropdown';
import type { StatusRow } from '@/server/projects/queries';
import { cn } from '@/utils/cn';

const FIELDS: TaskField[] = ['status', 'priority', 'due'];

const barButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-label-sm text-text-white-0/80 transition-colors duration-150 hover:bg-text-white-0/10 hover:text-text-white-0 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-text-white-0/10 data-[state=open]:text-text-white-0';

/**
 * Jira-style floating bar that appears while list rows are selected. Every
 * change applies to the whole selection in one server call.
 */
export function TaskBulkBar({
  count,
  statuses,
  timezone,
  pending,
  onPatch,
  onDelete,
  onClear,
}: {
  count: number;
  statuses: StatusRow[];
  timezone: string;
  pending: boolean;
  onPatch: (patch: TaskPatch) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  // Controlled so a pick from the due-date calendar (not a menu item) closes it too.
  const [openField, setOpenField] = useState<TaskField | null>(null);

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed inset-x-4 bottom-6 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-2xl bg-bg-strong-950 p-1.5 shadow-regular-md animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <span className="tabular shrink-0 px-2.5 text-label-sm text-text-white-0" aria-live="polite">
        {count} selected
      </span>
      <span className="mx-1 h-5 w-px shrink-0 bg-text-white-0/15" aria-hidden="true" />
      {FIELDS.map((field) => (
        <Dropdown.Root
          key={field}
          open={openField === field}
          onOpenChange={(open) => setOpenField(open ? field : null)}
        >
          <Dropdown.Trigger disabled={pending} className={cn(barButton, 'shrink-0')}>
            {FIELD_LABEL[field]}
            <IconChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Content
            side="top"
            align="start"
            // The due-date menu holds a calendar, too tall to scroll inside.
            className={field === 'due' ? 'w-max' : 'max-h-80 w-56 overflow-y-auto'}
          >
            <TaskFieldItems
              field={field}
              statuses={statuses}
              timezone={timezone}
              onPick={(patch) => {
                setOpenField(null);
                onPatch(patch);
              }}
            />
          </Dropdown.Content>
        </Dropdown.Root>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className={cn(barButton, 'shrink-0 text-error-base hover:text-error-base')}
      >
        <IconTrash className="size-4" aria-hidden="true" />
        Delete
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-text-white-0/15" aria-hidden="true" />
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        className={cn(barButton, 'w-8 shrink-0 justify-center px-0')}
      >
        <IconX className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
