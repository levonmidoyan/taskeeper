'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { IconPlus } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CollapsibleSection } from '@/components/task/CollapsibleSection';
import { SubtaskRow } from '@/components/task/SubtaskRow';
import { useSetParent } from '@/components/task/use-set-parent';
import { LOCAL_ESCAPE_EVENT } from '@/lib/local-escape';
import { settle } from '@/lib/settle';
import { MAX_SUBTASK_BATCH, progressPercent, splitPastedLines, stepTarget } from '@/lib/subtasks';
import { dropTarget } from '@/lib/todo-list';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { createSubtasksAction, createTaskAction, reorderSubtaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export function SubtaskSection({
  parent, subtasks, statuses, members, timezone, projectId, workspaceSlug, pageBase,
}: {
  parent: TaskRow;
  subtasks: TaskRow[];
  statuses: StatusRow[];
  members: MemberRow[];
  timezone: string;
  projectId: string;
  workspaceSlug: string;
  /** Set on a task's own page: subtasks open as pages under it, not via ?task=. */
  pageBase?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setParent = useSetParent(workspaceSlug);

  // Local order for optimistic drags; the server's order wins on every refresh.
  const serverIds = useMemo(() => subtasks.map((s) => s.id), [subtasks]);
  const [order, setOrder] = useState(serverIds);
  const [syncedIds, setSyncedIds] = useState(serverIds);
  if (serverIds !== syncedIds) {
    setSyncedIds(serverIds);
    setOrder(serverIds);
  }
  const byId = useMemo(() => new Map(subtasks.map((s) => [s.id, s])), [subtasks]);
  const rows = order.map((id) => byId.get(id)).filter((s): s is TaskRow => s !== undefined);

  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;
  const percent = progressPercent(doneCount, subtasks.length);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function reorder(id: string, target: { toIndex: number; beforeId: string | null; afterId: string | null }) {
    const previous = order;
    setOrder(arrayMove(order, order.indexOf(id), target.toIndex));
    void settle(reorderSubtaskAction(workspaceSlug, { taskId: id, beforeId: target.beforeId, afterId: target.afterId }))
      .then((result) => {
        if (result.ok) return;
        toast.error(result.error);
        setOrder(previous);
        router.refresh();
      });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const target = dropTarget(order, String(active.id), String(over.id));
    if (target) reorder(String(active.id), target);
  }

  function onStep(id: string, delta: -1 | 1) {
    const target = stepTarget(order, id, delta);
    if (!target) return;
    reorder(id, target);
    // Keep the moved row focused for the next Alt+arrow.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-subtask-id="${id}"] button[aria-label^="Rename"]`)?.focus());
  }

  function open(id: string) {
    if (pageBase) {
      router.push(`${pageBase}/${id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  // Add row.
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [pasted, setPasted] = useState<string[] | null>(null);

  async function addOne(title: string) {
    setPending(true);
    const result = await settle(createTaskAction(workspaceSlug, {
      projectId, title,
      // Subtasks land in the parent's column: they are part of work already in flight.
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

  async function addMany(titles: string[]) {
    setPasted(null);
    setPending(true);
    const result = await settle(createSubtasksAction(workspaceSlug, { parentTaskId: parent.id, titles }));
    setPending(false);
    if (!result.ok) toast.error(result.error);
    else router.refresh();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pasted) {
      void addMany(pasted);
      return;
    }
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;
    // Cleared up front so the field is ready for the next one; never disabled, which would blur it.
    if (inputRef.current) inputRef.current.value = '';
    void addOne(title);
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const lines = splitPastedLines(event.clipboardData.getData('text/plain'));
    if (lines.length < 2) return;
    event.preventDefault();
    if (lines.length > MAX_SUBTASK_BATCH) {
      toast.error('Up to 50 at a time.');
      return;
    }
    setPasted(lines);
  }

  function pasteAsOneLine() {
    if (!pasted || !inputRef.current) return;
    inputRef.current.value = pasted.join(' ').slice(0, 200);
    setPasted(null);
  }

  // Inside the dialog, Escape reaches the dialog first; while a paste waits for
  // its confirm the form claims it (data-local-escape) and hears of it by this
  // event. Otherwise Escape closes the dialog as usual.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!pasted || !form) return;
    const cancel = () => pasteAsOneLine();
    form.addEventListener(LOCAL_ESCAPE_EVENT, cancel);
    return () => form.removeEventListener(LOCAL_ESCAPE_EVENT, cancel);
  });

  return (
    <CollapsibleSection
      sectionId="subtasks"
      title="Subtasks"
      meta={`${doneCount}/${subtasks.length}`}
    >
      {subtasks.length > 0 && (
        <div
          role="progressbar"
          aria-label="Subtasks done"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 overflow-hidden rounded-full bg-bg-soft-200"
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-220', percent === 100 ? 'bg-success-base' : 'bg-primary-base')}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-10 ring-1 ring-inset ring-stroke-soft-200">
        {rows.length > 0 && (
          // An explicit id: dnd-kit's generated ids differ between server and browser render.
          <DndContext id={`subtasks-${parent.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul aria-label="Subtasks" className="border-b border-stroke-soft-200">
                {rows.map((subtask, i) => (
                  <SubtaskRow
                    key={subtask.id}
                    subtask={subtask}
                    statuses={statuses}
                    members={members}
                    timezone={timezone}
                    workspaceSlug={workspaceSlug}
                    isFirst={i === 0}
                    isLast={i === rows.length - 1}
                    onOpen={() => open(subtask.id)}
                    onStep={(delta) => onStep(subtask.id, delta)}
                    onPromote={() => setParent(subtask.id, null, parent.id, `“${subtask.title}” is now a task`)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <form ref={formRef} onSubmit={onSubmit} data-local-escape={pasted ? '' : undefined} className="flex items-center gap-2 px-3">
          <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
          <label htmlFor={`add-subtask-${parent.id}`} className="sr-only">Add a subtask</label>
          <input
            id={`add-subtask-${parent.id}`}
            ref={inputRef}
            name="title"
            maxLength={200}
            aria-busy={pending}
            placeholder="Add subtask…"
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && pasted && !e.defaultPrevented) {
                e.preventDefault();
                pasteAsOneLine();
              }
            }}
            className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:h-10 lg:text-paragraph-sm"
          />
        </form>
        {pasted && (
          <p role="status" className="border-t border-stroke-soft-200 px-3 py-2 text-paragraph-xs text-text-sub-600">
            <span className="text-text-strong-950">Create {pasted.length} subtasks?</span> Enter to confirm · Esc to paste as one line
          </p>
        )}
      </div>

      {subtasks.length === 0 && (
        <p className="text-paragraph-xs text-text-soft-400">Break this task into steps.</p>
      )}
    </CollapsibleSection>
  );
}
