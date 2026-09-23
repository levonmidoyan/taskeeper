import type { Priority } from '@/server/tasks/queries';

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

const PRIORITY_CLASS: Record<Priority, string> = {
  none: 'bg-muted-foreground/30',
  low: 'bg-muted-foreground',
  medium: 'bg-primary',
  high: 'bg-destructive/70',
  urgent: 'bg-destructive',
};

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${PRIORITY_CLASS[priority]}`} aria-hidden="true" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
