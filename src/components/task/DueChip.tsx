import { IconCalendarDue } from '@tabler/icons-react';
import * as Badge from '@/components/ui/badge';
import { formatDueDate, isOverdue } from '@/lib/dates';

export function DueChip({ dueDate, timezone }: { dueDate: string | null; timezone: string }) {
  if (!dueDate) return null;

  if (isOverdue(dueDate, timezone)) {
    return (
      <Badge.Root variant="lighter" color="red" size="medium" className="tabular">
        <Badge.Icon as={IconCalendarDue} />
        {/* The word "Overdue" carries the meaning; the red is reinforcement only. */}
        <span className="sr-only">Overdue. </span>
        Due {formatDueDate(dueDate, timezone)}
      </Badge.Root>
    );
  }

  return (
    <span className="tabular inline-flex items-center gap-1 text-paragraph-xs text-text-sub-600">
      <IconCalendarDue className="size-3.5" aria-hidden="true" />
      Due {formatDueDate(dueDate, timezone)}
    </span>
  );
}
