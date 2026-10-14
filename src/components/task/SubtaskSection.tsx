'use client';

import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CollapsibleSection } from '@/components/task/CollapsibleSection';
import { DoneIcon, StrikeText } from '@/components/task/DoneMark';
import * as Button from '@/components/ui/button';
import { LOCAL_ESCAPE_EVENT } from '@/lib/local-escape';
import { settle } from '@/lib/settle';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import { createTaskAction, deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';
import { Hint } from '@/components/shell/ShortcutHint';

export function SubtaskSection({
  parent,
  subtasks,
  statuses,
  projectId,
  workspaceSlug,
  pageBase,
}: {
  parent: TaskRow;
  subtasks: TaskRow[];
  statuses: StatusRow[];
  projectId: string;
  workspaceSlug: string;
  /** Set on a task's own page: subtasks open as pages under it, not via ?task=. */
  pageBase?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  // The input only shows once asked for, Jira-style, and stays for the next one.
  const [adding, setAdding] = useState(false);
  const returnFocus = useRef(false);

  function stopAdding() {
    returnFocus.current = true;
    setAdding(false);
  }

  // Inside a dialog, Escape reaches the dialog first; it hands it over by this event.
  useEffect(() => {
    const form = formRef.current;
    if (!adding || !form) return;
    const close = () => stopAdding();
    form.addEventListener(LOCAL_ESCAPE_EVENT, close);
    return () => form.removeEventListener(LOCAL_ESCAPE_EVENT, close);
  }, [adding]);

  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    addButtonRef.current?.focus();
  }, [adding]);

  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;

    // Cleared up front so the field is ready for the next subtask. Never
    // disabled either: that blurs it, and re-enabling does not restore focus.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await settle(createTaskAction(workspaceSlug, {
      projectId,
      title,
      // Subtasks land in the parent's column, not the leftmost one: they are
      // part of work already in flight.
      statusId: parent.statusId,
      parentTaskId: parent.id,
    }));
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }

    router.refresh();
  }

  return (
    <CollapsibleSection
      sectionId="subtasks"
      title="Subtasks"
      meta={`${doneCount}/${subtasks.length}`}
      actions={!adding && (
        <Button.Root
          ref={addButtonRef}
          type="button"
          variant="neutral"
          mode="ghost"
          size="xxsmall"
          onClick={() => setAdding(true)}
        >
          <Button.Icon as={IconPlus} />
          Add subtask
        </Button.Root>
      )}
    >
      {subtasks.length > 0 && (
        <ul className="overflow-hidden rounded-10 ring-1 ring-inset ring-stroke-soft-200">
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              statuses={statuses}
              workspaceSlug={workspaceSlug}
              pageBase={pageBase}
            />
          ))}
        </ul>
      )}

      {adding && (
        <form
          ref={formRef}
          onSubmit={onSubmit}
          data-local-escape=""
          className="relative flex items-center gap-2 rounded-10 px-3 ring-1 ring-inset ring-stroke-strong-950"
        >
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
            autoFocus
            placeholder="Add a subtask…"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.defaultPrevented) {
                event.preventDefault();
                stopAdding();
              }
            }}
            // Clicking away from an empty field puts the button back; a typed
            // title stays until submitted or escaped.
            onBlur={(event) => { if (!event.currentTarget.value.trim()) setAdding(false); }}
            className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
          />
        </form>
      )}
    </CollapsibleSection>
  );
}

function SubtaskRow({
  subtask,
  statuses,
  workspaceSlug,
  pageBase,
}: {
  subtask: TaskRow;
  statuses: StatusRow[];
  workspaceSlug: string;
  pageBase?: string;
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
      const result = await settle(updateTaskAction(workspaceSlug, { taskId: subtask.id, statusId: target.id }));
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function open() {
    if (pageBase) {
      router.push(`${pageBase}/${subtask.id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', subtask.id);
    // Same ?task= contract as the board, so a subtask is deep-linkable too.
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await settle(deleteTaskAction(workspaceSlug, { taskId: subtask.id }));
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="group flex items-center gap-2 border-b border-stroke-soft-200 pr-2 last:border-b-0">
      <Hint label={done ? 'Mark as not done' : 'Mark as done'}>
        <button
          type="button"
          onClick={toggleDone}
          disabled={pending}
          aria-pressed={done}
          aria-label={done ? `Mark "${subtask.title}" as not done` : `Mark "${subtask.title}" as done`}
          className="inline-flex size-11 shrink-0 items-center justify-center text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50"
        >
          <DoneIcon done={done} className="size-4" />
        </button>
      </Hint>

      <button
        type="button"
        onClick={open}
        className={cn(
          'min-w-0 flex-1 truncate py-3 text-left text-paragraph-sm transition-colors duration-220',
          done ? 'text-text-soft-400' : 'text-text-strong-950',
        )}
      >
        <StrikeText done={done}>{subtask.title}</StrikeText>
      </button>

      <Hint label="Delete subtask">
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
      </Hint>
    </li>
  );
}
