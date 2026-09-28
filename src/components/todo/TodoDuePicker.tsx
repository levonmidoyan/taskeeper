'use client';

import { IconCalendarPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { DueChip } from '@/components/task/DueChip';
import * as Popover from '@/components/ui/popover';

export function TodoDuePicker({
  title,
  dueDate,
  timezone,
  onChange,
}: {
  title: string;
  dueDate: string | null;
  timezone: string;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(value: string | null) {
    setOpen(false);
    if (value !== dueDate) onChange(value);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={dueDate ? `Change due date of "${title}"` : `Set due date for "${title}"`}
        className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-text-soft-400 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950 data-[state=open]:bg-bg-weak-50"
      >
        {dueDate
          ? <DueChip dueDate={dueDate} timezone={timezone} />
          : <IconCalendarPlus className="size-4" aria-hidden="true" />}
      </Popover.Trigger>
      <Popover.Content align="end" className="w-60 space-y-2 p-3">
        <label htmlFor="todo-due" className="text-label-sm text-text-strong-950">Due date</label>
        <input
          id="todo-due"
          type="date"
          defaultValue={dueDate ?? ''}
          // A native date input only fires change with a complete, valid day.
          onChange={(e) => { if (e.target.value) pick(e.target.value); }}
          className="h-9 w-full rounded-lg bg-bg-white-0 px-2 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="text-label-xs text-text-sub-600 hover:text-error-base"
          >
            Clear due date
          </button>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
