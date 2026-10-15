'use client';

import {
  IconCaretDownFilled,
  IconCaretUpDownFilled,
  IconCaretUpFilled,
  IconChevronLeft,
  IconChevronRight,
  IconCornerDownRight,
} from '@tabler/icons-react';
import {
  columnOrderingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  functionalUpdate,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useMemo, useRef, useState, useTransition, ViewTransition, type MouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { UserView } from '@/components/auth/user/user-view';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityChip } from '@/components/task/Priority';
import { TaskBulkBar } from '@/components/task/TaskBulkBar';
import type { TaskPatch } from '@/components/task/TaskFieldItems';
import { ParentPickerDialog } from '@/components/task/ParentPickerDialog';
import { TaskRowActions } from '@/components/task/TaskRowActions';
import { useSetParent } from '@/components/task/use-set-parent';
import { TaskTableSettings } from '@/components/task/TaskTableSettings';
import { StatusIcon } from '@/components/task/StatusIcon';
import * as Button from '@/components/ui/button';
import * as Divider from '@/components/ui/divider';
import * as StatusBadge from '@/components/ui/status-badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTableSettings } from '@/hooks/use-table-settings';
import { TASK_MORPH_SHARE, TASK_OPEN, taskMorphName } from '@/lib/motion';
import { settle } from '@/lib/settle';
import { focusedNavId } from '@/lib/shortcuts/nav';
import { useShortcut } from '@/lib/shortcuts/provider';
import type { TableSettings } from '@/lib/task-table-settings';
import {
  PRIORITY_RANK,
  boardOrder,
  compareKeys,
  formatSortParam,
  parsePageParam,
  parseSortParam,
} from '@/lib/task-table-sort';
import type { StatusRow } from '@/server/projects/queries';
import { bulkDeleteTasksAction, bulkUpdateTasksAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { formatDueDate, formatInZone, todayInZone } from '@/lib/dates';
import { cn } from '@/utils/cn';
import { Hint } from '@/components/shell/ShortcutHint';

const features = tableFeatures({
  columnOrderingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
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

type CellCtx = { statusById: Map<string, StatusRow>; timezone: string };

/** One cell's content, shared by tanstack rows and the hand-rendered subtask rows. */
function renderTaskCell(columnId: string, task: TaskRow, { statusById, timezone }: CellCtx): ReactNode {
  switch (columnId) {
    case 'title': {
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
          {/* Lists that load subtasks show the count on the expand chevron instead. */}
          {task.subtasks === undefined && task.subtaskCount > 0 && (
            <span className="tabular shrink-0 text-paragraph-xs text-text-sub-600">
              <span className="sr-only">Subtasks done: </span>
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          )}
        </span>
      );
    }
    case 'status': {
      const status = statusById.get(task.statusId);
      if (!status) return null;
      return (
        <StatusBadge.Root variant="stroke">
          <StatusIcon status={status} />
          {status.name}
        </StatusBadge.Root>
      );
    }
    case 'priority':
      return task.priority === 'none'
        ? <span className="text-paragraph-xs text-text-soft-400">—</span>
        : <PriorityChip priority={task.priority} />;
    case 'assignee': {
      const name = task.assigneeName;
      if (!name) return <span className="text-paragraph-xs text-text-soft-400">Unassigned</span>;
      return (
        <UserView
          user={{ name, image: task.assigneeImage }}
          hideSubtitle
          avatarClassName="size-6 text-[0.625rem]"
        />
      );
    }
    case 'due':
      return task.dueDate
        ? <DueChip dueDate={task.dueDate} timezone={timezone} done={task.completedAt !== null} />
        : <span className="text-paragraph-xs text-text-soft-400">—</span>;
    case 'created':
      return <InstantCell instant={task.createdAt} timezone={timezone} />;
    case 'updated':
      return <InstantCell instant={task.updatedAt} timezone={timezone} />;
    case 'labels': {
      const { labels } = task;
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
    }
    default:
      return null;
  }
}

function buildColumns(statusById: Map<string, StatusRow>, timezone: string) {
  const ctx: CellCtx = { statusById, timezone };
  return column.columns([
    column.accessor('title', {
      id: 'title',
      header: 'Title',
      sortFn: (a, b) =>
        a.original.title.localeCompare(b.original.title, undefined, { sensitivity: 'base' }),
      cell: ({ row }) => renderTaskCell('title', row.original, ctx),
    }),
    column.accessor((task) => statusById.get(task.statusId)?.position ?? '', {
      id: 'status',
      header: 'Status',
      sortFn: (a, b, id) => compareKeys(a.getValue<string>(id), b.getValue<string>(id)),
      cell: ({ row }) => renderTaskCell('status', row.original, ctx),
    }),
    column.accessor((task) => PRIORITY_RANK[task.priority], {
      id: 'priority',
      header: 'Priority',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) => renderTaskCell('priority', row.original, ctx),
    }),
    column.accessor((task) => task.assigneeName ?? undefined, {
      id: 'assignee',
      header: 'Assignee',
      // Unassigned rows sink to the bottom whichever way the column is sorted.
      sortUndefined: 'last',
      sortFn: (a, b, id) =>
        a.getValue<string>(id).localeCompare(b.getValue<string>(id), undefined, { sensitivity: 'base' }),
      cell: ({ row }) => renderTaskCell('assignee', row.original, ctx),
    }),
    column.accessor((task) => task.dueDate ?? undefined, {
      id: 'due',
      header: 'Due',
      sortUndefined: 'last',
      // YYYY-MM-DD strings order the same as the dates they name.
      sortFn: (a, b, id) => compareKeys(a.getValue<string>(id), b.getValue<string>(id)),
      cell: ({ row }) => renderTaskCell('due', row.original, ctx),
    }),
    column.accessor((task) => task.createdAt.getTime(), {
      id: 'created',
      header: 'Created',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) => renderTaskCell('created', row.original, ctx),
    }),
    column.accessor((task) => task.updatedAt.getTime(), {
      id: 'updated',
      header: 'Updated',
      sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      cell: ({ row }) => renderTaskCell('updated', row.original, ctx),
    }),
    column.display({
      id: 'labels',
      header: 'Labels',
      cell: ({ row }) => renderTaskCell('labels', row.original, ctx),
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

/**
 * Expands a parent into its subtask rows; carries the done count. A spacer on
 * lists that load subtasks, so titles line up; nothing on lists that don't.
 */
function Chevron({ task, open, onToggle }: { task: TaskRow; open: boolean; onToggle: () => void }) {
  if (task.subtasks === undefined) return null;
  if (task.subtasks.length === 0) return <span className="inline-block w-6 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-expanded={open}
      // aria-expanded carries the state, so the name stays put.
      aria-label={`Subtasks of ${task.title}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="tabular inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-paragraph-xs text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
    >
      <IconChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} aria-hidden="true" />
      {task.subtaskDoneCount}/{task.subtaskCount}
    </button>
  );
}

export function TaskTable({
  tasks,
  statuses,
  workspaceSlug,
  projectId,
  timezone,
}: {
  tasks: TaskRow[];
  statuses: StatusRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { settings, update: updateSettings, reset: resetSettings } = useTableSettings(projectId);
  const { pageSize, density } = settings;
  const columnVisibility = useMemo(
    () => Object.fromEntries(settings.hidden.map((id) => [id, false])),
    [settings.hidden],
  );

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
    // A new order makes the old page meaningless.
    next.delete('page');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // The URL owns the page too. A page past the end (rows deleted, a stale link)
  // shows the last one rather than an empty table.
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  const pagination: PaginationState = useMemo(
    () => ({
      pageIndex: Math.min(parsePageParam(searchParams.get('page')), pageCount - 1),
      pageSize,
    }),
    [searchParams, pageCount, pageSize],
  );

  // push, unlike sort: paging is a step Back should undo.
  function onPaginationChange(updater: Updater<PaginationState>) {
    const next = new URLSearchParams(searchParams);
    const { pageIndex } = functionalUpdate(updater, pagination);
    if (pageIndex > 0) next.set('page', String(pageIndex + 1));
    else next.delete('page');
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onSettingsChange(patch: Partial<TableSettings>) {
    updateSettings(patch);
    // A new page size moves every row to a different page, like a new sort.
    if (patch.pageSize !== undefined && patch.pageSize !== pageSize && searchParams.has('page')) {
      const next = new URLSearchParams(searchParams);
      next.delete('page');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (task) => task.id,
    state: { sorting, pagination, columnVisibility, columnOrder: settings.columnOrder },
    onSortingChange,
    onPaginationChange,
    autoResetPageIndex: false,
    enableMultiSort: false,
    sortDescFirst: false,
  });

  // The current page only; selection can still span pages.
  const rows = table.getRowModel().rows;
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [parentFor, setParentFor] = useState<TaskRow | null>(null);
  const setParent = useSetParent(workspaceSlug);
  // Parents showing their subtask rows. Client memory, collapsed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Parents and their subtasks: a selected subtask row counts for the bulk bar.
  const allTasks = useMemo(() => data.flatMap((t) => [t, ...(t.subtasks ?? [])]), [data]);
  // Rows deleted elsewhere drop out of the selection without an effect.
  const selectedIds = useMemo(
    () => allTasks.filter((t) => selection.has(t.id)).map((t) => t.id),
    [allTasks, selection],
  );
  // The header box speaks for the page on screen, as in Gmail.
  const pageSelectedCount = rows.filter((r) => selection.has(r.id)).length;
  const allSelected = rows.length > 0 && pageSelectedCount === rows.length;
  // The shift-click anchor: the last row toggled on its own.
  const anchorId = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  function clearSelection() {
    setSelection(new Set());
    anchorId.current = null;
  }

  function toggleAll() {
    const next = new Set(selectedIds);
    for (const r of rows) {
      if (allSelected) next.delete(r.id);
      else next.add(r.id);
    }
    setSelection(next);
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

  useShortcut('nav.clear', clearSelection, selectedIds.length > 0);
  useShortcut('nav.select', () => {
    const id = focusedNavId();
    const visible = rows.some((r) => r.id === id)
      || rows.some((r) => expanded.has(r.id) && r.original.subtasks?.some((s) => s.id === id));
    if (!id || !visible) return false;
    toggleRow(id, false);
  });

  function applyPatch(taskIds: string[], patch: TaskPatch) {
    startTransition(async () => {
      const result = await settle(bulkUpdateTasksAction(workspaceSlug, { taskIds, patch }));
      if (!result.ok) toast.error(result.error);
      else if (taskIds.length > 1) toast.success(`Updated ${result.data.updated} tasks`);
      router.refresh();
    });
  }

  async function deleteTasks(taskIds: string[]) {
    const ok = await confirm(
      taskIds.length === 1
        ? {
            title: `Delete "${allTasks.find((t) => t.id === taskIds[0])?.title ?? 'this task'}"?`,
            description: 'This also deletes its subtasks. It can’t be undone.',
          }
        : {
            title: `Delete ${taskIds.length} tasks?`,
            description: 'This also deletes their subtasks. It can’t be undone.',
          },
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await settle(bulkDeleteTasksAction(workspaceSlug, { taskIds }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.deleted === 1 ? 'Task deleted' : `Deleted ${result.data.deleted} tasks`);
      setSelection((prev) => new Set([...prev].filter((id) => !taskIds.includes(id))));
      router.refresh();
    });
  }

  const openTaskId = searchParams.get('task');

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('task', taskId);
    // Deep-linkable and back-dismissable (v1 spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false, transitionTypes: [TASK_OPEN] });
  }

  return (
    // Room below the table while the floating bulk bar is up, so it never hides
    // the last row or the pager.
    <div className={cn('mx-auto w-full max-w-400 px-4 py-4 lg:px-6', selectedIds.length > 0 && 'pb-24')}>
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stroke-sub-300 p-8 text-center">
          <p className="text-label-sm text-text-strong-950">No tasks yet</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Type below to add the first one.</p>
        </div>
      ) : (
        <>
          {/* Columns and density only shape the table, which phones don't show. */}
          <div className="mb-3 flex justify-end max-sm:hidden">
            <TaskTableSettings
              settings={settings}
              onChange={onSettingsChange}
              onReset={resetSettings}
              {...(data.some((t) => (t.subtasks ?? []).length > 0) && {
                onExpandAll: () => setExpanded(new Set(data.filter((t) => (t.subtasks ?? []).length > 0).map((t) => t.id))),
                onCollapseAll: () => setExpanded(new Set()),
              })}
            />
          </div>
          {/* The table scrolls sideways inside its own box on narrow screens, with
              Title pinned, so the page itself never scrolls horizontally. relative
              so absolute children (the sr-only header label) are clipped here too,
              not placed against the page. */}
          {/* Phones: one stacked row per task (title, status, due, assignee), no columns.
              No data-task-nav: the keyboard shortcuts walk the table's rows. */}
          <ul className="flex flex-col gap-1 sm:hidden" aria-label="Tasks">
            {rows.map((row) => {
              const t = row.original;
              const selected = selection.has(row.id);
              const status = statusById.get(t.statusId);
              const open = expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                <li
                  className={cn('flex items-center gap-3 rounded-xl px-3 py-1 ring-1 ring-inset ring-stroke-soft-200', selected && 'bg-primary-lighter')}
                >
                  <SelectBox label={`Select ${t.title}`} checked={selected} onClick={() => toggleRow(row.id, false)} />
                  <Chevron task={t} open={open} onToggle={() => toggleExpanded(row.id)} />
                  <button
                    type="button"
                    onClick={() => openTask(t.id)}
                    aria-label={t.title}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {status && <StatusIcon status={status} />}
                    <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">{t.title}</span>
                    <DueChip dueDate={t.dueDate} timezone={timezone} done={t.completedAt !== null} />
                    {t.assigneeName && <AssigneeAvatar name={t.assigneeName} image={t.assigneeImage} />}
                  </button>
                </li>
                {open && (t.subtasks ?? []).map((sub) => {
                  const subSelected = selection.has(sub.id);
                  const subStatus = statusById.get(sub.statusId);
                  return (
                    <li
                      key={sub.id}
                      className={cn('ml-8 flex items-center gap-3 rounded-xl px-3 py-1 ring-1 ring-inset ring-stroke-soft-200', subSelected && 'bg-primary-lighter')}
                    >
                      <SelectBox label={`Select ${sub.title}`} checked={subSelected} onClick={() => toggleRow(sub.id, false)} />
                      <button
                        type="button"
                        onClick={() => openTask(sub.id)}
                        aria-label={sub.title}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <IconCornerDownRight className="size-3.5 shrink-0 text-text-soft-400" aria-hidden="true" />
                        {subStatus && <StatusIcon status={subStatus} />}
                        <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">{sub.title}</span>
                        <DueChip dueDate={sub.dueDate} timezone={timezone} done={sub.completedAt !== null} />
                        {sub.assigneeName && <AssigneeAvatar name={sub.assigneeName} image={sub.assigneeImage} />}
                      </button>
                    </li>
                  );
                })}
                </Fragment>
              );
            })}
          </ul>
          <div className="relative overflow-x-auto max-sm:hidden">
            {/* border-separate so the end cells can round: the header is a pill and
                each row lights up as one on hover. Rows split by divider rows. */}
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 h-9 w-10 min-w-10 rounded-l-lg bg-bg-weak-50 pl-3 pr-0"
                    >
                      <span className="flex items-center">
                        <SelectBox
                          label="Select all tasks on this page"
                          checked={allSelected}
                          indeterminate={pageSelectedCount > 0 && !allSelected}
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
                            'h-9 bg-bg-weak-50 px-3 text-paragraph-sm font-normal text-text-sub-600 whitespace-nowrap',
                            COLUMN_WIDTH[col.id],
                            col.id === 'title' && 'sticky left-10 z-10',
                          )}
                        >
                          {canSort ? (
                            <button
                              type="button"
                              onClick={col.getToggleSortingHandler()}
                              className="-mx-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 transition-colors duration-150 hover:text-text-strong-950"
                            >
                              <table.FlexRender header={header} />
                              {sorted === 'asc' ? (
                                <IconCaretUpFilled className="size-4 text-text-sub-600" aria-hidden="true" />
                              ) : sorted === 'desc' ? (
                                <IconCaretDownFilled className="size-4 text-text-sub-600" aria-hidden="true" />
                              ) : (
                                <IconCaretUpDownFilled className="size-4 text-text-soft-400" aria-hidden="true" />
                              )}
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      );
                    })}
                    <th scope="col" className="h-9 w-12 rounded-r-lg bg-bg-weak-50 px-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                ))}
              </thead>
              <tbody>
                {/* Breathing room between the header pill and the first row. */}
                <tr aria-hidden="true">
                  <td colSpan={999} className="h-1 p-0" />
                </tr>
                {rows.map((row, i) => {
                  const selected = selection.has(row.id);
                  // Opaque even at rest: the pinned columns slide over the others.
                  const cellBg = selected
                    ? 'bg-primary-lighter'
                    : 'bg-bg-white-0 group-hover:bg-bg-weak-50';
                  const cellBase = cn(
                    density === 'compact' ? 'h-10' : 'h-12',
                    'transition-colors duration-150',
                  );
                  return (
                  <Fragment key={row.id}>
                  {i > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={999} className="py-1">
                        <Divider.Root variant="line-spacing" />
                      </td>
                    </tr>
                  )}
                  <tr
                    // The mouse can hit anywhere on the row; keyboard and screen
                    // readers use the title button, so the row needs no tab stop.
                    onClick={() => openTask(row.original.id)}
                    aria-selected={selected}
                    className="group cursor-pointer"
                  >
                    <td
                      className={cn(cellBase, cellBg, 'sticky left-0 z-10 w-10 min-w-10 rounded-l-xl pl-3 pr-0')}
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
                    {row.getVisibleCells().map((cell) => (
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
                          <span className="flex min-w-0 items-center gap-1">
                          <Chevron task={row.original} open={expanded.has(row.id)} onToggle={() => toggleExpanded(row.id)} />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTask(row.original.id);
                            }}
                            aria-label={row.original.title}
                            data-task-nav={row.original.id}
                            className="flex min-w-0 flex-1 text-left"
                          >
                            {(() => {
                              const morph = taskMorphName(row.original.id, openTaskId);
                              return (
                                // Keyed by name so the morph pairs with the modal (see KanbanCard).
                                <ViewTransition key={morph ?? 'open'} name={morph} share={TASK_MORPH_SHARE} default="none">
                                  <span className="flex min-w-0 flex-1">
                                    <table.FlexRender cell={cell} />
                                  </span>
                                </ViewTransition>
                              );
                            })()}
                          </button>
                          </span>
                        ) : (
                          <table.FlexRender cell={cell} />
                        )}
                      </td>
                    ))}
                    <td className={cn(cellBase, cellBg, 'w-12 rounded-r-xl px-2')}>
                      <TaskRowActions
                        task={row.original}
                        statuses={statuses}
                        timezone={timezone}
                        disabled={pending}
                        onOpen={() => openTask(row.original.id)}
                        onPatch={(patch) => applyPatch([row.original.id], patch)}
                        onDelete={() => deleteTasks([row.original.id])}
                        onMakeSubtask={() => setParentFor(row.original)}
                      />
                    </td>
                  </tr>
                  {expanded.has(row.id) && (row.original.subtasks ?? []).map((sub) => {
                    const subSelected = selection.has(sub.id);
                    const subBg = subSelected ? 'bg-primary-lighter' : 'bg-bg-white-0 group-hover:bg-bg-weak-50';
                    return (
                      <tr key={sub.id} onClick={() => openTask(sub.id)} aria-selected={subSelected} className="group cursor-pointer">
                        <td
                          className={cn(cellBase, subBg, 'sticky left-0 z-10 w-10 min-w-10 rounded-l-xl pl-3 pr-0')}
                          onClick={(e) => { e.stopPropagation(); toggleRow(sub.id, false); }}
                        >
                          <span className="flex items-center">
                            <SelectBox label={`Select ${sub.title}`} checked={subSelected} onClick={(e) => { e.stopPropagation(); toggleRow(sub.id, false); }} />
                          </span>
                        </td>
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.column.id}
                            className={cn(cellBase, subBg, 'px-3', COLUMN_WIDTH[cell.column.id], cell.column.id === 'title' && 'sticky left-10 z-10 max-w-md')}
                          >
                            {cell.column.id === 'title' ? (
                              <span className="flex min-w-0 items-center gap-1 pl-6">
                                <IconCornerDownRight className="size-3.5 shrink-0 text-text-soft-400" aria-hidden="true" />
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openTask(sub.id); }}
                                  aria-label={sub.title}
                                  data-task-nav={sub.id}
                                  className="flex min-w-0 flex-1 text-left"
                                >
                                  {renderTaskCell('title', sub, { statusById, timezone })}
                                </button>
                              </span>
                            ) : renderTaskCell(cell.column.id, sub, { statusById, timezone })}
                          </td>
                        ))}
                        <td className={cn(cellBase, subBg, 'w-12 rounded-r-xl px-2')}>
                          <TaskRowActions
                            task={sub}
                            statuses={statuses}
                            timezone={timezone}
                            disabled={pending}
                            onOpen={() => openTask(sub.id)}
                            onPatch={(patch) => applyPatch([sub.id], patch)}
                            onDelete={() => deleteTasks([sub.id])}
                            onPromote={() => setParent(sub.id, null, row.id, `“${sub.title}” is now a task`)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pageCount > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-3 flex items-center justify-between gap-3 text-paragraph-sm text-text-sub-600"
        >
          <span>
            {pagination.pageIndex * pageSize + 1}–
            {Math.min(data.length, (pagination.pageIndex + 1) * pageSize)} of {data.length}
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {pagination.pageIndex + 1} of {pageCount}
            </span>
            <Hint label="Previous page">
              <Button.Root
                variant="neutral"
                mode="stroke"
                size="xxsmall"
                aria-label="Previous page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <Button.Icon as={IconChevronLeft} />
              </Button.Root>
            </Hint>
            <Hint label="Next page">
              <Button.Root
                variant="neutral"
                mode="stroke"
                size="xxsmall"
                aria-label="Next page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <Button.Icon as={IconChevronRight} />
              </Button.Root>
            </Hint>
          </div>
        </nav>
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
      {parentFor && (
        <ParentPickerDialog
          open
          onOpenChange={(open) => { if (!open) setParentFor(null); }}
          taskId={parentFor.id}
          workspaceSlug={workspaceSlug}
          onPick={(p) => setParent(parentFor.id, p.id, null, `“${parentFor.title}” is now a subtask of “${p.title}”`)}
        />
      )}
    </div>
  );
}
