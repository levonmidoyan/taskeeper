/**
 * Reminder and digest constants, payload types and copy. Pure, so the cron,
 * the emails, the bell and the task dialog all read the same values.
 */

export const REMINDER_OFFSETS = [0, 1, 2, 7] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const OFFSET_LABEL: Record<ReminderOffset, string> = {
  0: 'On the day',
  1: '1 day before',
  2: '2 days before',
  7: '7 days before',
};

export const DEFAULT_REMINDER_HOUR = 9;

/**
 * False while vercel.json runs the reminders cron once a day (Vercel Hobby).
 * Flip together with the schedule ("0 * * * *") after moving to Pro.
 */
export const REMINDER_CRON_HOURLY = false;

export const DIGEST_TASK_CAP = 20;

export type ReminderData = {
  title: string;
  projectName: string;
  dueDate: string;
  offsetDays: ReminderOffset;
  /** Days from the recipient's local send date to the due date; the copy says this, not the offset. */
  daysLeft: number;
};
export type DigestData = {
  localDate: string;
  dueToday: number;
  overdue: number;
  tasks: { id: string; title: string; dueDate: string }[];
};
export type NotificationData = ReminderData | DigestData;

export function isReminderOffset(n: unknown): n is ReminderOffset {
  return typeof n === 'number' && (REMINDER_OFFSETS as readonly number[]).includes(n);
}

/** The due date is part of the key, so moving the date makes the reminder fire again. */
export function reminderKey(taskId: string, userId: string, dueDate: string, offsetDays: number): string {
  return `rem:${taskId}:${userId}:${dueDate}:${offsetDays}`;
}

export function digestKey(userId: string, workspaceId: string, localDate: string): string {
  return `dig:${userId}:${workspaceId}:${localDate}`;
}

export function dueInLabel(offsetDays: number): string {
  if (offsetDays === 0) return 'today';
  if (offsetDays === 1) return 'tomorrow';
  return `in ${offsetDays} days`;
}

export function reminderSubject(d: ReminderData): string {
  return `“${d.title}” is due ${dueInLabel(d.daysLeft)}`;
}

export function digestSummary(d: Pick<DigestData, 'dueToday' | 'overdue'>): string {
  const parts: string[] = [];
  if (d.dueToday > 0) parts.push(`${d.dueToday} due today`);
  if (d.overdue > 0) parts.push(`${d.overdue} overdue`);
  return parts.join(' · ');
}

export function digestSubject(d: DigestData, workspaceName: string): string {
  return `${digestSummary(d)} in ${workspaceName}`;
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** One claimed notification, ready to email. */
export type OutgoingMail = { notificationId: string; to: string; slug: string; workspaceName: string } & (
  | { kind: 'reminder'; taskId: string; data: ReminderData }
  | { kind: 'digest'; taskId: null; data: DigestData }
);

export type MailSender = (mail: OutgoingMail) => Promise<void>;

type BellItem = { kind: 'reminder' | 'digest'; taskId: string | null; data: NotificationData };

export function notificationText(item: Pick<BellItem, 'kind' | 'data'>): { title: string; detail: string } {
  if (item.kind === 'reminder') {
    const d = item.data as ReminderData;
    const when = dueInLabel(d.daysLeft);
    return { title: d.title, detail: `Due ${when} · ${d.projectName}` };
  }
  return { title: 'Daily digest', detail: digestSummary(item.data as DigestData) };
}

export function notificationHref(slug: string, item: Pick<BellItem, 'kind' | 'taskId'>): string {
  return item.kind === 'reminder' && item.taskId ? `/${slug}/tasks/${item.taskId}` : `/${slug}/calendar`;
}
