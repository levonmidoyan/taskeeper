'use client';

import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';
import { updateTaskAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

export function TaskRow({
  task,
  statuses,
  workspaceSlug,
  timezone,
}: {
  task: TaskRowData;
  statuses: StatusRow[];
  workspaceSlug: string;
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const done = task.completedAt !== null;

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, {
        taskId: task.id, statusId: target.id,
      });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function openDetail() {
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    // Deep-linkable and back-dismissable (v1 spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <li className="flex items-center gap-2 border-b border-stroke-soft-200 px-2 transition-colors duration-150 last:border-b-0 hover:bg-bg-weak-50">
      {/* A toggle button, not a checkbox: e2e and screen readers know it by this name
          (spec §10 A2). */}
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50"
      >
        {done
          ? <IconCircleCheckFilled className="size-5 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-5" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={openDetail}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-paragraph-sm',
            done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
          )}
        >
          {task.title}
        </span>

        {task.labels.map((label) => (
          <LabelChip key={label.id} name={label.name} className="hidden shrink-0 sm:inline-flex" />
        ))}

        {task.subtaskCount > 0 && (
          <span className="tabular hidden shrink-0 text-paragraph-xs text-text-sub-600 sm:inline">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}

        <PriorityDot priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} />

        {task.assigneeName && (
          <AssigneeAvatar name={task.assigneeName} className="hidden shrink-0 sm:flex" />
        )}
      </button>
    </li>
  );
}
