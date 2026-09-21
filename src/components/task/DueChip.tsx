import { CalendarClock } from 'lucide-react';
import { formatDueDate, isOverdue } from '@/lib/dates';

export function DueChip({ dueDate, timezone }: { dueDate: string | null; timezone: string }) {
  if (!dueDate) return null;

  const overdue = isOverdue(dueDate, timezone);

  return (
    <span
      className={`tabular inline-flex items-center gap-1 rounded-[var(--radius-button)] px-1.5 py-0.5 text-xs ${
        overdue ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'
      }`}
    >
      <CalendarClock className="size-3" aria-hidden="true" />
      {/* The word "Overdue" carries the meaning; the red is reinforcement only. */}
      {overdue && <span className="sr-only">Overdue. </span>}
      Due {formatDueDate(dueDate, timezone)}
    </span>
  );
}
