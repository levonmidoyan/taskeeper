import type { StatusRow } from '@/server/projects/queries';

/**
 * Where a task goes when its checkbox is clicked. Completion is a column, not a
 * flag (spec §3.2), so "done" means the first done column and "not done" means
 * the first open one. Returns null when the project has no such column, which
 * the caller reports rather than silently no-ops.
 */
export function doneToggleTarget(statuses: StatusRow[], done: boolean): StatusRow | null {
  return statuses.find((s) => (done ? !s.isDone : s.isDone)) ?? null;
}
