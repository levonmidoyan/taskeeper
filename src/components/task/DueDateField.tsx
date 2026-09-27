'use client';

import { IconCalendarDue, IconChevronDown } from '@tabler/icons-react';
import { useState } from 'react';
import * as Button from '@/components/ui/button';
import { Calendar } from '@/components/ui/datepicker';
import * as Label from '@/components/ui/label';
import * as Popover from '@/components/ui/popover';
import { selectVariants } from '@/components/ui/select';
import { formatDueDate, isOverdue, todayInZone } from '@/lib/dates';
import { cn } from '@/utils/cn';

// The picker works in local Date objects, but only ever as a calendar day:
// these two helpers are the whole boundary with the YYYY-MM-DD strings.
function toDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Due date as a popover calendar; `onChange` gets a bare YYYY-MM-DD or null. */
export function DueDateField({
  id,
  value: initial,
  timezone,
  onChange,
}: {
  id: string;
  value: string | null;
  timezone: string;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const { triggerRoot, triggerIcon, triggerArrow } = selectVariants({ size: 'medium' });

  function pick(next: string | null) {
    setOpen(false);
    if (next === value) return;
    setValue(next);
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
              selected={value ? toDate(value) : undefined}
              defaultMonth={toDate(value ?? today)}
              // "Today" is the workspace's, not the browser's.
              today={toDate(today)}
              onSelect={(date) => pick(toDay(date))}
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
