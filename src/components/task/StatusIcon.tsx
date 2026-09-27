import { IconCircleCheckFilled, IconCircleDashed, IconCircleHalf2 } from '@tabler/icons-react';
import { statusText } from '@/components/task/status-color';
import type { StatusRow } from '@/server/projects/queries';
import { cn } from '@/utils/cn';

/**
 * Statuses are free-form, so the glyph follows what a status means rather
 * than its name: done columns get a check, the primary hue reads as in
 * progress, anything else as not started.
 */
export function StatusIcon({
  status,
  className,
}: {
  status: Pick<StatusRow, 'color' | 'isDone'>;
  className?: string;
}) {
  const Glyph = status.isDone ? IconCircleCheckFilled : status.color === 'primary' ? IconCircleHalf2 : IconCircleDashed;
  const color = status.isDone ? 'text-success-base' : statusText(status.color);
  return <Glyph className={cn('size-4 shrink-0', color, className)} aria-hidden="true" />;
}
