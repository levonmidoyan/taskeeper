import {
  IconArchive, IconBan, IconBolt, IconBug, IconBulb, IconCircle, IconCircleCheckFilled,
  IconCircleDashed, IconCircleHalf2, IconClock, IconEye, IconFlag, IconFlame, IconInbox,
  IconPlayerPause, IconProgress, IconRocket, IconStar, type TablerIcon,
} from '@tabler/icons-react';
import { statusText } from '@/components/task/status-color';
import { isStatusIconKey, type StatusIconKey } from '@/lib/status-icons';
import type { StatusRow } from '@/server/projects/queries';
import { cn } from '@/utils/cn';

export const STATUS_ICONS: Record<StatusIconKey, { glyph: TablerIcon; label: string }> = {
  'circle-dashed': { glyph: IconCircleDashed, label: 'Not started' },
  circle: { glyph: IconCircle, label: 'Open' },
  'circle-half': { glyph: IconCircleHalf2, label: 'Half way' },
  'circle-check': { glyph: IconCircleCheckFilled, label: 'Complete' },
  progress: { glyph: IconProgress, label: 'In progress' },
  clock: { glyph: IconClock, label: 'Waiting' },
  eye: { glyph: IconEye, label: 'Review' },
  flag: { glyph: IconFlag, label: 'Flag' },
  bug: { glyph: IconBug, label: 'Bug' },
  rocket: { glyph: IconRocket, label: 'Release' },
  star: { glyph: IconStar, label: 'Star' },
  bolt: { glyph: IconBolt, label: 'Urgent' },
  flame: { glyph: IconFlame, label: 'Hot' },
  bulb: { glyph: IconBulb, label: 'Idea' },
  pause: { glyph: IconPlayerPause, label: 'Paused' },
  ban: { glyph: IconBan, label: 'Blocked' },
  archive: { glyph: IconArchive, label: 'Archived' },
  inbox: { glyph: IconInbox, label: 'Inbox' },
};

/** The icon a status shows when none has been picked for it. */
export function derivedIcon(status: Pick<StatusRow, 'color' | 'isDone'>): StatusIconKey {
  return status.isDone ? 'circle-check' : status.color === 'primary' ? 'circle-half' : 'circle-dashed';
}

/**
 * Statuses are free-form, so unless a column has been given an icon the glyph
 * follows what the status means rather than its name: done columns get a
 * check, the primary hue reads as in progress, anything else as not started.
 */
export function StatusIcon({
  status,
  className,
}: {
  status: Pick<StatusRow, 'color' | 'isDone'> & { icon?: string | null };
  className?: string;
}) {
  const { glyph: Glyph } = STATUS_ICONS[isStatusIconKey(status.icon) ? status.icon : derivedIcon(status)];
  const color = status.isDone ? 'text-success-base' : statusText(status.color);
  return <Glyph className={cn('size-4 shrink-0', color, className)} aria-hidden="true" />;
}
