'use client';

// Client: Badge.Icon takes the icon component via `as`, which can't cross the RSC boundary.

import { IconCalendarDue } from '@tabler/icons-react';
import * as Badge from '@/components/ui/badge';
import { formatDueDate, isOverdue } from '@/lib/dates';

/** `done`: a finished task is never overdue, however late it was finished. */
export function DueChip({ dueDate, timezone, done = false }: { dueDate: string | null; timezone: string; done?: boolean }) {
  if (!dueDate) return null;

  if (!done && isOverdue(dueDate, timezone)) {
    return (
      <Badge.Root variant="lighter" color="red" size="medium" className="tabular whitespace-nowrap">
        <Badge.Icon as={IconCalendarDue} />
        {/* The word "Overdue" carries the meaning; the red is reinforcement only. */}
        <span className="sr-only">Overdue. </span>
        Due {formatDueDate(dueDate, timezone)}
      </Badge.Root>
    );
  }

  return (
    <span className="tabular inline-flex items-center gap-1 whitespace-nowrap text-paragraph-xs text-text-sub-600">
      <IconCalendarDue className="size-3.5" aria-hidden="true" />
      Due {formatDueDate(dueDate, timezone)}
    </span>
  );
}
