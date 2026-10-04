'use client';

import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { projectDot } from '@/components/brand/tint';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { PriorityChip } from '@/components/task/Priority';
import { StatusIcon } from '@/components/task/StatusIcon';
import { formatSortParam, parseSortParam, type SortableColumn } from '@/lib/task-table-sort';
import type { WorkspaceTaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const COLUMNS: { id: SortableColumn | null; label: string; className?: string }[] = [
  { id: 'title', label: 'Title' },
  { id: null, label: 'Project', className: 'max-md:hidden' },
  { id: 'status', label: 'Status', className: 'max-sm:hidden' },
  { id: 'priority', label: 'Priority', className: 'max-sm:hidden' },
  { id: 'assignee', label: 'Assignee', className: 'max-md:hidden' },
  { id: 'due', label: 'Due' },
];

/** Tasks across projects. Read-only; sorting is a link, done by the server. */
export function WorkspaceTaskTable({
  workspaceSlug,
  tasks,
  timezone,
}: {
  workspaceSlug: string;
  tasks: WorkspaceTaskRow[];
  timezone: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [current] = parseSortParam(searchParams.get('sort'));

  function sortHref(id: SortableColumn): string {
    const next = new URLSearchParams(searchParams);
    // asc → desc → off, the List's cycle.
    const param = current?.id !== id ? formatSortParam([{ id, desc: false }])
      : !current.desc ? formatSortParam([{ id, desc: true }]) : null;
    if (param) next.set('sort', param);
    else next.delete('sort');
    return `${pathname}?${next.toString()}`;
  }

  return (
    <table className="w-full text-left">
      <thead className="border-b border-stroke-soft-200 text-label-xs text-text-sub-600">
        <tr>
          {COLUMNS.map((c) => {
            const sorted = c.id && current?.id === c.id ? (current.desc ? 'descending' : 'ascending') : undefined;
            return (
              <th key={c.label} scope="col" aria-sort={sorted} className={cn('px-4 py-2 font-medium lg:px-6', c.className)}>
                {c.id ? (
                  <Link href={sortHref(c.id)} replace scroll={false} className="inline-flex items-center gap-1 hover:text-text-strong-950">
                    {c.label}
                    {sorted === 'ascending' && <IconArrowUp className="size-3.5" aria-hidden="true" />}
                    {sorted === 'descending' && <IconArrowDown className="size-3.5" aria-hidden="true" />}
                  </Link>
                ) : c.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id} className="border-b border-stroke-soft-200 text-paragraph-sm hover:bg-bg-weak-50">
            <td className="max-w-0 px-4 py-2 lg:px-6">
              <Link href={`/${workspaceSlug}/tasks/${t.id}`} className={cn('block truncate text-label-sm', t.isDone ? 'text-text-soft-400 line-through' : 'text-text-strong-950')}>
                {t.title}
              </Link>
            </td>
            <td className="px-4 py-2 max-md:hidden lg:px-6">
              <span className="inline-flex items-center gap-2 text-text-sub-600">
                <span className={cn('size-2 rounded-full', projectDot({ id: t.projectId, color: t.projectColor }))} aria-hidden="true" />
                {t.projectName}
              </span>
            </td>
            <td className="px-4 py-2 max-sm:hidden lg:px-6">
              <span className="inline-flex items-center gap-1.5 text-text-sub-600">
                <StatusIcon status={{ color: t.statusColor, isDone: t.isDone, icon: t.statusIcon }} />
                {t.statusName}
              </span>
            </td>
            <td className="px-4 py-2 max-sm:hidden lg:px-6"><PriorityChip priority={t.priority} /></td>
            <td className="px-4 py-2 max-md:hidden lg:px-6">
              {t.assigneeName ? (
                <span className="inline-flex items-center gap-2 text-text-sub-600">
                  <AssigneeAvatar name={t.assigneeName} image={t.assigneeImage} />
                  {t.assigneeName}
                </span>
              ) : <span className="text-text-soft-400">—</span>}
            </td>
            <td className="px-4 py-2 lg:px-6"><DueChip dueDate={t.dueDate} timezone={timezone} done={t.isDone} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
