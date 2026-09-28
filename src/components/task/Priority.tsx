import {
  IconAlertSquareFilled, IconAntennaBars1, IconAntennaBars3, IconAntennaBars4, IconAntennaBars5,
  type Icon,
} from '@tabler/icons-react';
import type { Priority } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

/** Bar fills, for the summary breakdown. */
export const PRIORITY_DOT: Record<Priority, string> = {
  none: 'bg-faded-light',
  low: 'bg-faded-base',
  medium: 'bg-information-base',
  high: 'bg-warning-base',
  urgent: 'bg-error-base',
};

/** Signal bars rise with priority; urgent breaks the pattern on purpose. */
const PRIORITY_ICON: Record<Priority, Icon> = {
  none: IconAntennaBars1,
  low: IconAntennaBars3,
  medium: IconAntennaBars4,
  high: IconAntennaBars5,
  urgent: IconAlertSquareFilled,
};

const PRIORITY_TEXT: Record<Priority, string> = {
  none: 'text-text-soft-400',
  low: 'text-faded-base',
  medium: 'text-information-base',
  high: 'text-warning-base',
  urgent: 'text-error-base',
};

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Glyph = PRIORITY_ICON[priority];
  return <Glyph className={cn('size-4 shrink-0', PRIORITY_TEXT[priority], className)} aria-hidden="true" />;
}

export function PriorityChip({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1 text-paragraph-xs text-text-sub-600">
      <PriorityIcon priority={priority} className="size-3.5" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
