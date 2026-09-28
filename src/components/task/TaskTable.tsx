'use client';

import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';
import {
  createColumnHelper,
  createSortedRowModel,
  functionalUpdate,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityChip } from '@/components/task/Priority';
import { TaskBulkBar } from '@/components/task/TaskBulkBar';
import type { TaskPatch } from '@/components/task/TaskFieldItems';
import { TaskRowActions } from '@/components/task/TaskRowActions';
import { StatusIcon } from '@/components/task/StatusIcon';
import * as StatusBadge from '@/components/ui/status-badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  PRIORITY_RANK,
  boardOrder,
  compareKeys,
  formatSortParam,
  parseSortParam,
} from '@/lib/task-table-sort';
import type { StatusRow } from '@/server/projects/queries';
import { bulkDeleteTasksAction, bulkUpdateTasksAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { formatDueDate, formatInZone, todayInZone } from '@/lib/dates';
import { cn } from '@/utils/cn';

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const column = createColumnHelper<typeof features, TaskRow>();

const VISIBLE_LABELS = 2;

/** A timestamp cell: the day at a glance, the exact time on hover. */
function InstantCell({ instant, timezone }: { instant: Date; timezone: string }) {
  return (
    <time
      dateTime={instant.toISOString()}
      title={formatInZone(instant, timezone)}
      className="tabular whitespace-nowrap text-paragraph-sm text-text-sub-600"
    >
      {formatDueDate(todayInZone(timezone, instant), timezone)}
    </time>
  );
}

function buildColumns(statusById: Map<string, StatusRow>, timezone: string) {
  return column.columns([
    column.accessor('title', {
      id: 'title',
      header: 'Title',
      sortFn: (a, b) =>
        a.original.title.localeCompare(b.original.title, undefined, { sensitivity: 'base' }),
      cell: ({ row }) => {
        const task = row.original;
        const done = task.completedAt !== null;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'min-w-0 truncate text-paragraph-sm',
                done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
              )}
            >
              {task.title}
            </span>
            {task.subtaskCount > 0 && (
              <span className="tabular shrink-0 text-paragraph-xs text-text-sub-600">
                <span className="sr-only">Subtasks done: </span>
                {task.subtaskDoneCount}/{task.subtaskCount}
              </span>
            )}
          </span>
        );
      },
    }),
    column.accessor((task) => statusById.get(task.statusId)?.position ?? '', {
      id: 'status',
      header: 'Status',
      sortFn: (a, b, id) => compareKeys(a.getValue<string>(id), b.getValue<string>(id)),
      cell: ({ row }) => {
        const status = statusById.get(row.original.statusId);
        if (!status) return null;
        return (
          <StatusBadge.Root variant="stroke">
            <StatusIcon status={status} />
            {status.name}
          </StatusBadge.Root>
        );
      },
    }),
    column.accessor((task) => PRIORITY_RANK[task.priority], {
      id: 'priority',
      header: 'Priority',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) =>
        row.original.priority === 'none'
          ? <span className="text-paragraph-xs text-text-soft-400">—</span>
          : <PriorityChip priority={row.original.priority} />,
    }),
    column.accessor((task) => task.assigneeName ?? undefined, {
      id: 'assignee',
      header: 'Assignee',
      // Unassigned rows sink to the bottom whichever way the column is sorted.
      sortUndefined: 'last',
      sortFn: (a, b, id) =>
        a.getValue<string>(id).localeCompare(b.getValue<string>(id), undefined, { sensitivity: 'base' }),
      cell: ({ row }) => {
        const name = row.original.assigneeName;
        if (!name) return <span className="text-paragraph-xs text-text-soft-400">Unassigned</span>;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <AssigneeAvatar name={name} image={row.original.assigneeImage} className="shrink-0" />
            <span className="truncate text-paragraph-sm text-text-sub-600">{name}</span>
          </span>
        );
      },
    }),
    column.accessor((task) => task.dueDate ?? undefined, {
      id: 'due',
      header: 'Due',
      sortUndefined: 'last',
      // YYYY-MM-DD strings order the same as the dates they name.
      sortFn: (a, b, id) => compareKeys(a.getValue<string>(id), b.getValue<string>(id)),
      cell: ({ row }) =>
        row.original.dueDate
          ? <DueChip dueDate={row.original.dueDate} timezone={timezone} />
          : <span className="text-paragraph-xs text-text-soft-400">—</span>,
    }),
    column.accessor((task) => task.createdAt.getTime(), {
      id: 'created',
      header: 'Created',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) => <InstantCell instant={row.original.createdAt} timezone={timezone} />,
    }),
    column.accessor((task) => task.updatedAt.getTime(), {
      id: 'updated',
      header: 'Updated',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) => <InstantCell instant={row.original.updatedAt} timezone={timezone} />,
    }),
    column.display({
      id: 'labels',
      header: 'Labels',
      cell: ({ row }) => {
        const { labels } = row.original;
        if (labels.length === 0) return null;
        const extra = labels.length - VISIBLE_LABELS;
        return (
          <span className="flex items-center gap-1">
            {labels.slice(0, VISIBLE_LABELS).map((label) => (
              <LabelChip key={label.id} name={label.name} className="shrink-0" />
            ))}
            {extra > 0 && (
              <span
                className="tabular shrink-0 text-paragraph-xs text-text-sub-600"
                title={labels.slice(VISIBLE_LABELS).map((l) => l.name).join(', ')}
              >
                +{extra}
              </span>
            )}
          </span>
        );
      },
    }),
  ]);
}

const COLUMN_WIDTH: Record<string, string> = {
  title: 'min-w-64',
  status: 'w-36',
  priority: 'w-32',
  assignee: 'w-44',
  due: 'w-36',
  created: 'w-32',
  updated: 'w-32',
  labels: 'w-48',
};

function SelectBox({
  checked,
  indeterminate = false,
  label,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onClick: (e: MouseEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      // onClick rather than onChange: the handler needs shiftKey for range select.
      onClick={onClick}
      onChange={() => {}}
      className="size-4 cursor-pointer rounded accent-primary-base"
    />
  );
}

export function TaskTable({
  tasks,
  statuses,
  workspaceSlug,
  timezone,
}: {
  tasks: TaskRow[];
  statuses: StatusRow[];
  workspaceSlug: string;
  timezone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const columns = useMemo(() => buildColumns(statusById, timezone), [statusById, timezone]);
  // With no sort the table shows rows in data order, so the data arrives in board order.
  const data = useMemo(() => boardOrder(tasks, statuses), [tasks, statuses]);
  const sorting: SortingState = useMemo(
    () => parseSortParam(searchParams.get('sort')),
    [searchParams],
  );

  // The URL owns the sort, so it survives reloads and shared links. replace, not
  // push: re-sorting is not a step worth walking back through, and ?task= stays.
  function onSortingChange(updater: Updater<SortingState>) {
    const next = new URLSearchParams(searchParams);
    const param = formatSortParam(functionalUpdate(updater, sorting));
    if (param) next.set('sort', param);
    else next.delete('sort');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (task) => task.id,
    state: { sorting },
    onSortingChange,
    enableMultiSort: false,
    sortDescFirst: false,
  });

  const rows = table.getRowModel().rows;
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  // Rows deleted elsewhere drop out of the selection without an effect.
  const selectedIds = useMemo(
    () => data.filter((t) => selection.has(t.id)).map((t) => t.id),
    [data, selection],
  );
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  // The shift-click anchor: the last row toggled on its own.
  const anchorId = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  function clearSelection() {
    setSelection(new Set());
    anchorId.current = null;
  }

  function toggleAll() {
    setSelection(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
    anchorId.current = null;
  }

  function toggleRow(taskId: string, shiftKey: boolean) {
    const next = new Set(selectedIds);
    const ids = rows.map((r) => r.id);
    const from = anchorId.current ? ids.indexOf(anchorId.current) : -1;
    if (shiftKey && from !== -1) {
      // Range in on-screen order, so it follows the current sort. The range
      // takes the anchor's state, as in Jira and every file manager.
      const to = ids.indexOf(taskId);
      const on = next.has(anchorId.current!);
      for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) next.add(id);
        else next.delete(id);
      }
    } else {
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      anchorId.current = taskId;
    }
    setSelection(next);
  }

  useEffect(() => {
    if (selectedIds.length === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !ignoreShortcut(e)) clearSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds.length]);

  function applyPatch(taskIds: string[], patch: TaskPatch) {
    startTransition(async () => {
      const result = await bulkUpdateTasksAction(workspaceSlug, { taskIds, patch });
      if (!result.ok) toast.error(result.error);
      else if (taskIds.length > 1) toast.success(`Updated ${result.data.updated} tasks`);
      router.refresh();
    });
  }

  async function deleteTasks(taskIds: string[]) {
    const ok = await confirm(
      taskIds.length === 1
        ? {
            title: `Delete "${tasks.find((t) => t.id === taskIds[0])?.title ?? 'this task'}"?`,
            description: 'This also deletes its subtasks. It can’t be undone.',
          }
        : {
            title: `Delete ${taskIds.length} tasks?`,
            description: 'This also deletes their subtasks. It can’t be undone.',
          },
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await bulkDeleteTasksAction(workspaceSlug, { taskIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.deleted === 1 ? 'Task deleted' : `Deleted ${result.data.deleted} tasks`);
      setSelection((prev) => new Set([...prev].filter((id) => !taskIds.includes(id))));
      router.refresh();
    });
  }

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('task', taskId);
    // Deep-linkable and back-dismissable (v1 spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 lg:px-6">
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">No tasks yet</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Type below to add the first one.</p>
        </div>
      ) : (
        // The table scrolls sideways inside its own box on narrow screens, with
        // Title pinned, so the page itself never scrolls horizontally.
        <div className="overflow-x-auto rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 h-10 w-10 min-w-10 border-b border-stroke-soft-200 bg-bg-weak-50 pl-3 pr-0"
                  >
                    <span className="flex items-center">
                      <SelectBox
                        label="Select all tasks"
                        checked={allSelected}
                        indeterminate={selectedIds.length > 0 && !allSelected}
                        onClick={toggleAll}
                      />
                    </span>
                  </th>
                  {group.headers.map((header) => {
                    const col = header.column;
                    const sorted = col.getIsSorted();
                    const canSort = col.getCanSort();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        className={cn(
                          'h-10 border-b border-stroke-soft-200 bg-bg-weak-50 px-3 text-label-xs font-medium text-text-sub-600 whitespace-nowrap',
                          COLUMN_WIDTH[col.id],
                          col.id === 'title' && 'sticky left-10 z-10',
                        )}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={col.getToggleSortingHandler()}
                            className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors duration-150 hover:text-text-strong-950"
                          >
                            <table.FlexRender header={header} />
                            {sorted === 'asc' ? (
                              <IconArrowUp className="size-3.5" aria-hidden="true" />
                            ) : sorted === 'desc' ? (
                              <IconArrowDown className="size-3.5" aria-hidden="true" />
                            ) : (
                              <IconArrowsSort className="size-3.5 opacity-40" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="h-10 w-12 border-b border-stroke-soft-200 bg-bg-weak-50 px-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selection.has(row.id);
                const cellBg = selected
                  ? 'bg-primary-lighter'
                  : 'bg-bg-white-0 group-hover:bg-bg-weak-50';
                const cellBase = 'h-11 border-b border-stroke-soft-200 transition-colors duration-150 group-last:border-b-0';
                return (
                <tr
                  key={row.id}
                  // The mouse can hit anywhere on the row; keyboard and screen
                  // readers use the title button, so the row needs no tab stop.
                  onClick={() => openTask(row.original.id)}
                  aria-selected={selected}
                  className="group cursor-pointer"
                >
                  <td
                    className={cn(cellBase, cellBg, 'sticky left-0 z-10 w-10 min-w-10 pl-3 pr-0')}
                    // A near-miss on the checkbox must not open the task.
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(row.id, e.shiftKey);
                    }}
                  >
                    <span className="flex items-center">
                      <SelectBox
                        label={`Select ${row.original.title}`}
                        checked={selected}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(row.id, e.shiftKey);
                        }}
                      />
                    </span>
                  </td>
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        cellBase,
                        cellBg,
                        'px-3',
                        COLUMN_WIDTH[cell.column.id],
                        cell.column.id === 'title' && 'sticky left-10 z-10 max-w-md',
                      )}
                    >
                      {cell.column.id === 'title' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTask(row.original.id);
                          }}
                          aria-label={row.original.title}
                          className="flex w-full min-w-0 text-left"
                        >
                          <table.FlexRender cell={cell} />
                        </button>
                      ) : (
                        <table.FlexRender cell={cell} />
                      )}
                    </td>
                  ))}
                  <td className={cn(cellBase, cellBg, 'w-12 px-2')}>
                    <TaskRowActions
                      task={row.original}
                      statuses={statuses}
                      timezone={timezone}
                      disabled={pending}
                      onOpen={() => openTask(row.original.id)}
                      onPatch={(patch) => applyPatch([row.original.id], patch)}
                      onDelete={() => deleteTasks([row.original.id])}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedIds.length > 0 && (
        <TaskBulkBar
          count={selectedIds.length}
          statuses={statuses}
          timezone={timezone}
          pending={pending}
          onPatch={(patch) => applyPatch(selectedIds, patch)}
          onDelete={() => deleteTasks(selectedIds)}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}
