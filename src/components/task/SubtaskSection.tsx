'use client';

import { IconCircle, IconCircleCheckFilled, IconPlus, IconTrash } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import { createTaskAction, deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export function SubtaskSection({
  parent,
  subtasks,
  statuses,
  projectId,
  workspaceSlug,
}: {
  parent: TaskRow;
  subtasks: TaskRow[];
  statuses: StatusRow[];
  projectId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;

    // Cleared up front so the field is ready for the next subtask, the same
    // bargain QuickAddTask makes.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await createTaskAction(workspaceSlug, {
      projectId,
      title,
      // Subtasks land in the parent's column, not the leftmost one: they are
      // part of work already in flight.
      statusId: parent.statusId,
      parentTaskId: parent.id,
    });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }

    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-label-sm text-text-strong-950">Subtasks</h2>
        <span className="tabular text-paragraph-xs text-text-sub-600">
          {doneCount}/{subtasks.length}
        </span>
      </div>

      {subtasks.length > 0 && (
        <ul className="overflow-hidden rounded-10 ring-1 ring-inset ring-stroke-soft-200">
          {subtasks.map((subtask) => (
            <SubtaskRow key={subtask.id} subtask={subtask} statuses={statuses} workspaceSlug={workspaceSlug} />
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="relative flex items-center gap-2 px-1">
        <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
        <label htmlFor={`add-subtask-${parent.id}`} className="sr-only">
          Add a subtask
        </label>
        <input
          id={`add-subtask-${parent.id}`}
          ref={inputRef}
          name="title"
          maxLength={200}
          aria-busy={pending}
          placeholder="Add a subtask…"
          className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
        />
      </form>
    </section>
  );
}

function SubtaskRow({
  subtask,
  statuses,
  workspaceSlug,
}: {
  subtask: TaskRow;
  statuses: StatusRow[];
  workspaceSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const done = subtask.completedAt !== null;

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, { taskId: subtask.id, statusId: target.id });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function open() {
    const next = new URLSearchParams(searchParams);
    next.set('task', subtask.id);
    // Same ?task= contract as the board, so a subtask is deep-linkable too.
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteTaskAction(workspaceSlug, { taskId: subtask.id });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="group flex items-center gap-2 border-b border-stroke-soft-200 pr-2 last:border-b-0">
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${subtask.title}" as not done` : `Mark "${subtask.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50"
      >
        {done
          ? <IconCircleCheckFilled className="size-4 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-4" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={open}
        className={cn(
          'min-w-0 flex-1 truncate py-3 text-left text-paragraph-sm',
          done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
        )}
      >
        {subtask.title}
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete "${subtask.title}"`}
        // Always reachable by keyboard and on touch; only the hover styling is
        // conditional, so the row stays quiet until pointed at.
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-soft-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:text-error-base disabled:opacity-50"
      >
        <IconTrash className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}
