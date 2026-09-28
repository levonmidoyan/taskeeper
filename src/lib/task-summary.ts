import { todayInZone } from '@/lib/dates';
import type { StatusRow } from '@/server/projects/queries';
import type { Priority, TaskRow } from '@/server/tasks/queries';

export const SUMMARY_PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/** How far ahead "due soon" looks, today included. */
export const DUE_SOON_DAYS = 7;

export type TaskSummary = {
  total: number;
  open: number;
  done: number;
  /** Open tasks whose due day has passed in the workspace zone. */
  overdue: number;
  /** Open tasks due today or within the next DUE_SOON_DAYS - 1 days. */
  dueSoon: number;
  byStatus: { status: StatusRow; count: number }[];
  byPriority: { priority: Priority; count: number }[];
};

/** Shifts a YYYY-MM-DD calendar day. UTC keeps DST from nudging it by an hour. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The Summary view's numbers, from the task list the page already loads. Done
 * means completed, the same flag the board and list grey out, so overdue and
 * due-soon only count work that is still open.
 */
export function summarizeTasks(
  tasks: TaskRow[],
  statuses: StatusRow[],
  tz: string,
  now: Date = new Date(),
): TaskSummary {
  const today = todayInZone(tz, now);
  const soonEnd = addDays(today, DUE_SOON_DAYS);

  const statusCounts = new Map<string, number>();
  const priorityCounts = new Map<Priority, number>();
  let done = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const task of tasks) {
    statusCounts.set(task.statusId, (statusCounts.get(task.statusId) ?? 0) + 1);
    priorityCounts.set(task.priority, (priorityCounts.get(task.priority) ?? 0) + 1);

    if (task.completedAt !== null) {
      done += 1;
      continue;
    }
    if (!task.dueDate) continue;
    // YYYY-MM-DD strings compare in date order (see isOverdue).
    if (task.dueDate < today) overdue += 1;
    else if (task.dueDate < soonEnd) dueSoon += 1;
  }

  return {
    total: tasks.length,
    open: tasks.length - done,
    done,
    overdue,
    dueSoon,
    byStatus: statuses.map((status) => ({ status, count: statusCounts.get(status.id) ?? 0 })),
    byPriority: SUMMARY_PRIORITIES.map((priority) => ({
      priority,
      count: priorityCounts.get(priority) ?? 0,
    })),
  };
}
