'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconArrowBarToUp, IconArrowDown, IconArrowUp, IconArrowUpRight, IconCalendarDue, IconDots, IconGripVertical, IconTrash,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Hint } from '@/components/shell/ShortcutHint';
import { AssigneePicker } from '@/components/task/AssigneePicker';
import { DoneIcon, StrikeText } from '@/components/task/DoneMark';
import { DueChip } from '@/components/task/DueChip';
import { StatusIcon } from '@/components/task/StatusIcon';
import { TaskFieldItems, type TaskPatch } from '@/components/task/TaskFieldItems';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useServerValue } from '@/hooks/use-server-value';
import * as Dropdown from '@/components/ui/dropdown';
import { LOCAL_ESCAPE_EVENT } from '@/lib/local-escape';
import { settle } from '@/lib/settle';
import { doneToggleTarget } from '@/lib/task-done';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

/** Revealed on hover/focus; always shown where there is no hover (touch). */
const REVEAL = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100';

export function SubtaskRow({
  subtask, statuses, members, timezone, workspaceSlug, isFirst, isLast, onOpen, onStep, onPromote,
}: {
  subtask: TaskRow;
  statuses: StatusRow[];
  members: MemberRow[];
  timezone: string;
  workspaceSlug: string;
  isFirst: boolean;
  isLast: boolean;
  onOpen: () => void;
  onStep: (delta: -1 | 1) => void;
  onPromote: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: subtask.id });

  // Optimistic copies, reverted on a rejected save.
  const [statusId, setStatusId] = useServerValue(subtask.statusId);
  const [assigneeId, setAssigneeId] = useServerValue(subtask.assigneeId);
  const [dueDate, setDueDate] = useServerValue(subtask.dueDate);
  const [title, setTitle] = useServerValue(subtask.title);

  const status = statuses.find((s) => s.id === statusId);
  const done = status?.isDone ?? subtask.completedAt !== null;

  function save(patch: Parameters<typeof updateTaskAction>[1], revert: () => void) {
    startTransition(async () => {
      const result = await settle(updateTaskAction(workspaceSlug, patch));
      if (!result.ok) {
        toast.error(result.error);
        revert();
      }
      router.refresh();
    });
  }

  function setStatus(next: string) {
    const previous = statusId;
    setStatusId(next);
    save({ taskId: subtask.id, statusId: next }, () => setStatusId(previous));
  }

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    setStatus(target.id);
  }

  function pickField(patch: TaskPatch) {
    if (patch.statusId) setStatus(patch.statusId);
    if (patch.dueDate !== undefined) {
      const previous = dueDate;
      setDueDate(patch.dueDate);
      save({ taskId: subtask.id, dueDate: patch.dueDate }, () => setDueDate(previous));
    }
  }

  function assign(next: string | null) {
    const previous = assigneeId;
    setAssigneeId(next);
    save({ taskId: subtask.id, assigneeId: next }, () => setAssigneeId(previous));
  }

  // Inline rename.
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function stopEditing(commit: boolean) {
    const next = inputRef.current?.value.trim() ?? '';
    returnFocus.current = true;
    setEditing(false);
    if (!commit || !next || next === subtask.title) return;
    const previous = title;
    setTitle(next);
    save({ taskId: subtask.id, title: next }, () => setTitle(previous));
  }

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    titleButtonRef.current?.focus();
  }, [editing]);

  // Inside the dialog, Escape reaches the dialog first; it hands it over by this event.
  useEffect(() => {
    const form = formRef.current;
    if (!editing || !form) return;
    const cancel = () => stopEditing(false);
    form.addEventListener(LOCAL_ESCAPE_EVENT, cancel);
    return () => form.removeEventListener(LOCAL_ESCAPE_EVENT, cancel);
  });

  async function onDelete() {
    if (!(await confirm({ title: `Delete "${subtask.title}"?`, description: 'This can’t be undone.' }))) return;
    startTransition(async () => {
      const result = await settle(deleteTaskAction(workspaceSlug, { taskId: subtask.id }));
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-subtask-id={subtask.id}
      onKeyDown={(e) => {
        // Portalled menus (a row's dropdowns) bubble here through React, not the DOM.
        if (!e.altKey || editing || !e.currentTarget.contains(e.target as Node)) return;
        if (e.key === 'ArrowUp' && !isFirst) { e.preventDefault(); onStep(-1); }
        if (e.key === 'ArrowDown' && !isLast) { e.preventDefault(); onStep(1); }
      }}
      className={cn(
        'group flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-stroke-soft-200 bg-bg-white-0 pr-2 last:border-b-0 lg:flex-nowrap',
        isDragging && 'relative z-10 shadow-regular-md',
      )}
    >
      <Hint label="Drag to reorder (or Alt+↑/↓)">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder “${title}”`}
          className={cn('inline-flex h-11 w-5 shrink-0 cursor-grab items-center justify-center text-text-soft-400 max-lg:hidden', REVEAL)}
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      </Hint>

      <Hint label={done ? 'Mark as not done' : 'Mark as done'}>
        <button
          type="button"
          onClick={toggleDone}
          disabled={pending}
          aria-pressed={done}
          aria-label={done ? `Mark “${title}” as not done` : `Mark “${title}” as done`}
          className="inline-flex size-11 shrink-0 items-center justify-center text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50 lg:size-9"
        >
          <DoneIcon done={done} className="size-4" />
        </button>
      </Hint>

      {editing ? (
        <form
          ref={formRef}
          data-local-escape=""
          className="min-w-0 flex-1"
          onSubmit={(e) => { e.preventDefault(); stopEditing(true); }}
        >
          <input
            ref={inputRef}
            aria-label="Subtask title"
            defaultValue={title}
            maxLength={200}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => stopEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); stopEditing(false); }
            }}
            className="h-9 w-full rounded-md bg-transparent px-1 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-stroke-strong-950"
          />
        </form>
      ) : (
        <button
          ref={titleButtonRef}
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Rename “${title}”`}
          className={cn(
            'min-w-0 flex-1 truncate py-3 text-left text-paragraph-sm transition-colors duration-220 lg:py-2',
            done ? 'text-text-soft-400' : 'text-text-strong-950',
          )}
        >
          <StrikeText done={done}>{title}</StrikeText>
        </button>
      )}

      {/* Fields wrap under the title below lg. */}
      <div className="flex shrink-0 items-center gap-1 max-lg:basis-full max-lg:pb-2 max-lg:pl-11">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={`Status: ${status?.name ?? 'Unknown'}`}
              className="inline-flex h-7 max-w-36 items-center gap-1 rounded-md px-1.5 text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
            >
              {status && <StatusIcon status={status} />}
              <span className="truncate">{status?.name}</span>
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end" className="min-w-44">
            <TaskFieldItems field="status" statuses={statuses} timezone={timezone} onPick={pickField} />
          </Dropdown.Content>
        </Dropdown.Root>

        <AssigneePicker
          compact
          members={members}
          value={assigneeId}
          onChange={assign}
          // Named after the row while unassigned: a bare "Assign" repeats down the list.
          label={assigneeId ? undefined : `Assign “${title}”`}
        />

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={dueDate ? `Due date: ${dueDate}` : 'Set due date'}
              className={cn(
                'inline-flex h-7 items-center rounded-md px-1 text-text-soft-400 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950',
                !dueDate && REVEAL,
              )}
            >
              {dueDate ? <DueChip dueDate={dueDate} timezone={timezone} done={done} /> : <IconCalendarDue className="size-4" aria-hidden="true" />}
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end">
            <TaskFieldItems field="due" statuses={statuses} timezone={timezone} onPick={pickField} />
          </Dropdown.Content>
        </Dropdown.Root>

        <Hint label="Open subtask">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open “${title}”`}
            className={cn('inline-flex size-7 items-center justify-center rounded-md text-text-soft-400 hover:bg-bg-weak-50 hover:text-text-strong-950', REVEAL)}
          >
            <IconArrowUpRight className="size-4" aria-hidden="true" />
          </button>
        </Hint>

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={`More for “${title}”`}
              className={cn('inline-flex size-7 items-center justify-center rounded-md text-text-soft-400 hover:bg-bg-weak-50 hover:text-text-strong-950', REVEAL)}
            >
              <IconDots className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end" className="w-48">
            <Dropdown.Item onSelect={onOpen}><Dropdown.ItemIcon as={IconArrowUpRight} />Open</Dropdown.Item>
            <Dropdown.Item disabled={isFirst} onSelect={() => onStep(-1)}><Dropdown.ItemIcon as={IconArrowUp} />Move up</Dropdown.Item>
            <Dropdown.Item disabled={isLast} onSelect={() => onStep(1)}><Dropdown.ItemIcon as={IconArrowDown} />Move down</Dropdown.Item>
            <Dropdown.Item onSelect={onPromote}><Dropdown.ItemIcon as={IconArrowBarToUp} />Promote to task</Dropdown.Item>
            <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
            <Dropdown.Item onSelect={onDelete} className="text-error-base">
              <Dropdown.ItemIcon as={IconTrash} className="text-error-base" />Delete
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Root>
      </div>
    </li>
  );
}
