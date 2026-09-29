'use client';

import { IconCalendarOff } from '@tabler/icons-react';
import { PRIORITY_LABEL, PriorityIcon } from '@/components/task/Priority';
import { StatusIcon } from '@/components/task/StatusIcon';
import { Calendar } from '@/components/ui/datepicker';
import * as Dropdown from '@/components/ui/dropdown';
import { addDays, dateToDay, dayToDate, todayInZone } from '@/lib/dates';
import type { StatusRow } from '@/server/projects/queries';
import type { Priority } from '@/server/tasks/queries';
import type { BulkUpdateTasksInput } from '@/server/tasks/service';

export type TaskPatch = BulkUpdateTasksInput['patch'];
export type TaskField = 'status' | 'priority' | 'due';

export const FIELD_LABEL: Record<TaskField, string> = {
  status: 'Status',
  priority: 'Priority',
  due: 'Due date',
};

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/**
 * The choices for one task field, as dropdown items. Shared by the row menu
 * (inside a submenu) and the bulk bar (as a menu of its own), so both offer
 * exactly the same values.
 *
 * The due-date calendar is not a menu item, so picking a day there doesn't
 * close the menu by itself — callers close it from `onPick`.
 */
export function TaskFieldItems({
  field,
  statuses,
  timezone,
  onPick,
}: {
  field: TaskField;
  statuses: StatusRow[];
  timezone: string;
  onPick: (patch: TaskPatch) => void;
}) {
  if (field === 'status') {
    return statuses.map((s) => (
      <Dropdown.Item key={s.id} onSelect={() => onPick({ statusId: s.id })}>
        <StatusIcon status={s} />
        {s.name}
      </Dropdown.Item>
    ));
  }

  if (field === 'priority') {
    return PRIORITIES.map((p) => (
      <Dropdown.Item key={p} onSelect={() => onPick({ priority: p })}>
        <PriorityIcon priority={p} />
        {PRIORITY_LABEL[p]}
      </Dropdown.Item>
    ));
  }

  // Due dates are calendar days in the workspace zone, never instants.
  const today = todayInZone(timezone);
  const presets = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'In a week', date: addDays(today, 7) },
  ];
  return (
    <>
      {presets.map((p) => (
        <Dropdown.Item key={p.label} onSelect={() => onPick({ dueDate: p.date })}>
          {p.label}
        </Dropdown.Item>
      ))}
      <Dropdown.Item onSelect={() => onPick({ dueDate: null })}>
        <Dropdown.ItemIcon as={IconCalendarOff} />
        No due date
      </Dropdown.Item>
      <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
      <div className="px-1 pb-1">
        <Calendar
          mode="single"
          defaultMonth={dayToDate(today)}
          // "Today" is the workspace's, not the browser's.
          today={dayToDate(today)}
          onSelect={(date) => date && onPick({ dueDate: dateToDay(date) })}
        />
      </div>
    </>
  );
}
