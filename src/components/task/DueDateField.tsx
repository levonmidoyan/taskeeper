'use client';

import { IconCalendarDue, IconChevronDown } from '@tabler/icons-react';
import { useState } from 'react';
import * as Button from '@/components/ui/button';
import { Calendar } from '@/components/ui/datepicker';
import * as Label from '@/components/ui/label';
import * as Popover from '@/components/ui/popover';
import { selectVariants } from '@/components/ui/select';
import { dateToDay, dayToDate, formatDueDate, isOverdue, todayInZone } from '@/lib/dates';
import { cn } from '@/utils/cn';

/** Due date as a popover calendar; controlled. `onChange` gets a bare YYYY-MM-DD or null. */
export function DueDateField({
  id,
  value,
  timezone,
  onChange,
}: {
  id: string;
  value: string | null;
  timezone: string;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRoot, triggerIcon, triggerArrow } = selectVariants({ size: 'medium' });

  function pick(next: string | null) {
    setOpen(false);
    if (next === value) return;
    onChange(next);
  }

  const today = todayInZone(timezone);
  const overdue = value !== null && isOverdue(value, timezone);

  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>Due date</Label.Root>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button id={id} type="button" className={triggerRoot()} data-placeholder={value ? undefined : ''}>
            <IconCalendarDue className={cn(triggerIcon(), 'size-5', overdue && 'text-error-base')} aria-hidden="true" />
            <span className="tabular flex-1 truncate">
              {value ? formatDueDate(value, timezone) : 'No due date'}
            </span>
            {overdue && <span className="text-paragraph-xs text-error-base">Overdue</span>}
            <IconChevronDown className={triggerArrow()} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Content align="end" sideOffset={8} showArrow={false} className="p-0">
          <div className="p-3">
            <Calendar
              mode="single"
              // Clicking the chosen day again keeps it; "Clear" is the way out.
              required
              selected={value ? dayToDate(value) : undefined}
              defaultMonth={dayToDate(value ?? today)}
              // "Today" is the workspace's, not the browser's.
              today={dayToDate(today)}
              onSelect={(date) => pick(dateToDay(date))}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-stroke-soft-200 p-3">
            <Button.Root type="button" variant="neutral" mode="ghost" size="xsmall" onClick={() => pick(null)}>
              Clear
            </Button.Root>
            <Button.Root type="button" variant="neutral" mode="stroke" size="xsmall" onClick={() => pick(today)}>
              Today
            </Button.Root>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
