'use client';

import { projectDot } from '@/components/brand/tint';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { StatusIcon } from '@/components/task/StatusIcon';
import { formatDueDate } from '@/lib/dates';
import type { CalendarTask } from '@/server/tasks/calendar';
import { cn } from '@/utils/cn';

/**
 * Phone view of a month: only the days with tasks, as a list. Rows read like
 * CalendarChip (status or project dot, struck through when done, tinted when
 * overdue), but there is no drag: the due date changes in the task.
 */
export function CalendarAgenda({ days, byDay, today, showProject, onOpen }: {
  days: string[];
  byDay: Map<string, CalendarTask[]>;
  today: string;
  showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const shown = days.filter((d) => byDay.has(d));
  if (shown.length === 0) {
    return <p className="py-8 text-center text-paragraph-sm text-text-sub-600 sm:hidden">No tasks due this month.</p>;
  }
  return (
    <ol className="flex flex-col gap-4 sm:hidden" aria-label="Tasks by day">
      {shown.map((day) => (
        <li key={day}>
          <h3 className={cn('mb-1 text-label-sm', day === today ? 'text-primary-base' : 'text-text-sub-600')}>
            {formatDueDate(day, 'UTC', new Date(`${today}T12:00:00Z`))}
          </h3>
          <ul className="flex flex-col gap-1">
            {byDay.get(day)!.map((t) => {
              const overdue = !t.isDone && t.dueDate < today;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(t)}
                    aria-label={`${t.title}${t.isDone ? ', done' : overdue ? ', overdue' : ''}`}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-paragraph-sm ring-1 ring-inset',
                      'bg-bg-white-0 ring-stroke-soft-200 hover:bg-bg-weak-50',
                      overdue && 'bg-error-lighter ring-error-light',
                    )}
                  >
                    {showProject ? (
                      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', projectDot({ id: t.projectId, color: t.projectColor }))} />
                    ) : (
                      <StatusIcon status={{ color: t.statusColor, isDone: t.isDone, icon: t.statusIcon }} className="size-4 shrink-0" />
                    )}
                    <span className={cn('min-w-0 flex-1 truncate', t.isDone ? 'text-text-soft-400 line-through' : 'text-text-strong-950')}>
                      {t.title}
                    </span>
                    {t.assigneeName && <AssigneeAvatar name={t.assigneeName} image={t.assigneeImage} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
