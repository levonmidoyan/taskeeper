import type { StatusRow } from '@/server/projects/queries';
import type { Priority, TaskRow } from '@/server/tasks/queries';

/** The List table's sortable columns, which are also the ids written to ?sort=. */
export const SORTABLE_COLUMNS = ['title', 'status', 'priority', 'assignee', 'due'] as const;
export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];
export type TableSort = { id: SortableColumn; desc: boolean };

/** Ascending reads most urgent first, the way Jira sorts priority. */
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0, high: 1, medium: 2, low: 3, none: 4,
};

/**
 * Fractional-index keys (lib/position) order by code unit, not by locale, so
 * they are compared with < rather than localeCompare.
 */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The List's order with no sort applied: column by column, then within a column
 * by card position — the same order the board reads left to right, top to bottom.
 */
export function boardOrder(tasks: TaskRow[], statuses: StatusRow[]): TaskRow[] {
  const statusPosition = new Map(statuses.map((s) => [s.id, s.position]));
  return [...tasks].sort(
    (a, b) =>
      compareKeys(statusPosition.get(a.statusId) ?? '', statusPosition.get(b.statusId) ?? '')
      || compareKeys(a.position, b.position),
  );
}

/** `due.asc` → one sort; anything malformed or unknown means no sort. */
export function parseSortParam(param: string | null | undefined): TableSort[] {
  if (!param) return [];
  const [id, dir] = param.split('.');
  if (!(SORTABLE_COLUMNS as readonly string[]).includes(id)) return [];
  if (dir !== 'asc' && dir !== 'desc') return [];
  return [{ id: id as SortableColumn, desc: dir === 'desc' }];
}

export function formatSortParam(sorting: readonly { id: string; desc: boolean }[]): string | null {
  const first = sorting[0];
  if (!first || !(SORTABLE_COLUMNS as readonly string[]).includes(first.id)) return null;
  return `${first.id}.${first.desc ? 'desc' : 'asc'}`;
}
