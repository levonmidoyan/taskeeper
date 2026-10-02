'use client';

import { IconCalendarPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { DueChip } from '@/components/task/DueChip';
import * as Button from '@/components/ui/button';
import { Calendar } from '@/components/ui/datepicker';
import * as Popover from '@/components/ui/popover';
import { dateToDay, dayToDate, todayInZone } from '@/lib/dates';

export function TodoDuePicker({
  title,
  dueDate,
  done = false,
  timezone,
  onChange,
}: {
  title: string;
  dueDate: string | null;
  done?: boolean;
  timezone: string;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(value: string | null) {
    setOpen(false);
    if (value !== dueDate) onChange(value);
  }

  const today = todayInZone(timezone);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={dueDate ? `Change due date of "${title}"` : `Set due date for "${title}"`}
        className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-text-soft-400 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950 data-[state=open]:bg-bg-weak-50"
      >
        {dueDate
          ? <DueChip dueDate={dueDate} timezone={timezone} done={done} />
          : <IconCalendarPlus className="size-4" aria-hidden="true" />}
      </Popover.Trigger>
      <Popover.Content align="end" sideOffset={8} showArrow={false} className="p-0">
        <div className="p-3">
          <Calendar
            mode="single"
            // Clicking the chosen day again keeps it; "Clear" is the way out.
            required
            selected={dueDate ? dayToDate(dueDate) : undefined}
            defaultMonth={dayToDate(dueDate ?? today)}
            // "Today" is the workspace's, not the browser's.
            today={dayToDate(today)}
            onSelect={(date) => pick(dateToDay(date))}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-stroke-soft-200 p-3">
          <Button.Root
            type="button"
            variant="neutral"
            mode="ghost"
            size="xsmall"
            disabled={!dueDate}
            onClick={() => pick(null)}
          >
            Clear
          </Button.Root>
          <Button.Root type="button" variant="neutral" mode="stroke" size="xsmall" onClick={() => pick(today)}>
            Today
          </Button.Root>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
