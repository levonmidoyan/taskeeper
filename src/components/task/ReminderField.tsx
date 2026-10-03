'use client';

import { IconBell, IconBellRinging, IconCheck } from '@tabler/icons-react';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Dropdown from '@/components/ui/dropdown';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import { OFFSET_LABEL, REMINDER_OFFSETS, type ReminderOffset } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import { setTaskRemindersAction } from '@/server/reminders/actions';
import { cn } from '@/utils/cn';

/** My personal reminders on this task. Teammates never see them. */
export function ReminderField({
  id,
  workspaceSlug,
  taskId,
  value,
  hasDueDate,
}: {
  id: string;
  workspaceSlug: string;
  taskId: string;
  value: ReminderOffset[];
  hasDueDate: boolean;
}) {
  const [offsets, setOffsets] = useState(value);
  const [, startTransition] = useTransition();

  function toggle(offset: ReminderOffset) {
    const previous = offsets;
    const next = offsets.includes(offset) ? offsets.filter((o) => o !== offset) : [...offsets, offset].sort((a, b) => a - b);
    setOffsets(next);
    startTransition(async () => {
      const result = await settle(setTaskRemindersAction(workspaceSlug, { taskId, offsets: next }));
      if (!result.ok) {
        toast.error(result.error);
        setOffsets(previous);
      }
    });
  }

  const summary = offsets.length ? offsets.map((o) => OFFSET_LABEL[o]).join(', ') : 'No reminder';

  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>Remind me</Label.Root>
      <Dropdown.Root>
        <Dropdown.Trigger asChild disabled={!hasDueDate}>
          <button
            id={id}
            type="button"
            aria-describedby={hasDueDate ? undefined : `${id}-hint`}
            className={cn(
              'flex h-9 items-center gap-2 rounded-10 px-3 text-left text-paragraph-sm ring-1 ring-inset ring-stroke-soft-200',
              'hover:bg-bg-weak-50 disabled:cursor-not-allowed disabled:text-text-disabled-300',
            )}
          >
            {offsets.length && hasDueDate
              ? <IconBellRinging className="size-4 text-primary-base" aria-hidden="true" />
              : <IconBell className="size-4 text-text-soft-400" aria-hidden="true" />}
            <span className="truncate">{summary}</span>
          </button>
        </Dropdown.Trigger>
        <Dropdown.Content align="start">
          {REMINDER_OFFSETS.map((o) => (
            <DropdownPrimitive.CheckboxItem
              key={o}
              checked={offsets.includes(o)}
              // Keep the menu open so several can be picked in one go.
              onSelect={(event) => { event.preventDefault(); toggle(o); }}
              className="group/item relative flex cursor-pointer select-none items-center gap-2 rounded-lg p-2 text-paragraph-sm text-text-strong-950 outline-none data-[highlighted]:bg-bg-weak-50"
            >
              <span className="flex size-4 items-center justify-center">
                <DropdownPrimitive.ItemIndicator><IconCheck className="size-4" aria-hidden="true" /></DropdownPrimitive.ItemIndicator>
              </span>
              {OFFSET_LABEL[o]}
            </DropdownPrimitive.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Root>
      {!hasDueDate && <Hint.Root id={`${id}-hint`}>Set a due date to add a reminder.</Hint.Root>}
    </div>
  );
}
