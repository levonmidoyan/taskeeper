'use client';

import { Circle, CircleCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';
import { updateTaskAction } from '@/server/tasks/actions';

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
  const doneStatus = statuses.find((s) => s.isDone);
  const openStatus = statuses.find((s) => !s.isDone);

  function toggleDone() {
    const target = done ? openStatus : doneStatus;
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
    // Deep-linkable and back-dismissable (spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <li className="flex items-center gap-3 border-b border-border px-2 transition-colors duration-150 last:border-b-0 hover:bg-muted/60">
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
      >
        {done
          ? <CircleCheck className="size-5 text-success" aria-hidden="true" />
          : <Circle className="size-5" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={openDetail}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            done ? 'text-muted-foreground line-through' : 'text-foreground'
          }`}
        >
          {task.title}
        </span>

        {task.labels.map((label) => (
          <span
            key={label.id}
            className="hidden shrink-0 rounded-[var(--radius-button)] bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline"
          >
            {label.name}
          </span>
        ))}

        {task.subtaskCount > 0 && (
          <span className="tabular hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}

        <PriorityDot priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} />

        {task.assigneeName && (
          <span
            aria-label={`Assigned to ${task.assigneeName}`}
            className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground sm:inline-flex"
          >
            {task.assigneeName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
    </li>
  );
}
