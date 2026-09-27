import type { Priority } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

const PRIORITY_DOT: Record<Priority, string> = {
  none: 'bg-faded-light',
  low: 'bg-faded-base',
  medium: 'bg-information-base',
  high: 'bg-warning-base',
  urgent: 'bg-error-base',
};

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-paragraph-xs text-text-sub-600">
      <span className={cn('size-2 rounded-full', PRIORITY_DOT[priority])} aria-hidden="true" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
