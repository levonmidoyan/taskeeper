'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { IconChecklist, IconChevronRight } from '@tabler/icons-react';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { SortableTodoItem, TodoItem, type TodoItemHandlers } from '@/components/todo/TodoItem';
import { TodoQuickAdd } from '@/components/todo/TodoQuickAdd';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { Result } from '@/lib/result';
import { settle } from '@/lib/settle';
import { applyTodoOp, dropTarget, type TodoOp } from '@/lib/todo-list';
import {
  deleteTodoAction, moveTodoAction, updateTodoAction,
} from '@/server/todos/actions';
import type { TodoLists } from '@/server/todos/queries';
import { cn } from '@/utils/cn';

export function TodoList({
  workspaceSlug,
  timezone,
  lists,
}: {
  workspaceSlug: string;
  timezone: string;
  lists: TodoLists;
}) {
  const [view, apply] = useOptimistic(lists, applyTodoOp);
  const [, startTransition] = useTransition();
  const [showDone, setShowDone] = useState(false);
  const confirm = useConfirm();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Optimistic first, server second. On success the action's revalidatePath
   * delivers fresh props in the same transition; on failure the props are
   * unchanged, so dropping the optimistic layer is the rollback.
   */
  function run(op: TodoOp, call: () => Promise<Result<unknown>>) {
    startTransition(async () => {
      apply(op);
      const result = await call();
      if (!result.ok) toast.error(result.error);
    });
  }

  const handlers: TodoItemHandlers = {
    onToggle: (item) => {
      const done = item.completedAt === null;
      run({ kind: 'toggle', id: item.id, done, now: new Date() },
        () => settle(updateTodoAction(workspaceSlug, { todoId: item.id, done })));
    },
    onRename: (item, title) =>
      run({ kind: 'edit', id: item.id, title },
        () => settle(updateTodoAction(workspaceSlug, { todoId: item.id, title }))),
    onDue: (item, dueDate) =>
      run({ kind: 'edit', id: item.id, dueDate },
        () => settle(updateTodoAction(workspaceSlug, { todoId: item.id, dueDate }))),
    onDelete: async (item) => {
      if (!(await confirm({ title: `Delete "${item.title}"?`, description: 'This can’t be undone.' }))) return;
      run({ kind: 'delete', id: item.id },
        () => settle(deleteTodoAction(workspaceSlug, { todoId: item.id })));
    },
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const id = String(active.id);
    const target = dropTarget(view.open.map((t) => t.id), id, String(over.id));
    if (!target) return;
    run({ kind: 'move', id, toIndex: target.toIndex },
      () => settle(moveTodoAction(workspaceSlug, { todoId: id, beforeId: target.beforeId, afterId: target.afterId })));
  }

  const empty = view.open.length === 0 && view.done.length === 0;

  return (
    <div className="mt-6 space-y-6">
      <TodoQuickAdd workspaceSlug={workspaceSlug} />

      {empty ? (
        <div className="flex flex-col items-center rounded-20 border border-dashed border-stroke-sub-300 px-8 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-lighter text-primary-base ring-1 ring-inset ring-primary-alpha-16">
            <IconChecklist className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 text-label-sm text-text-strong-950">Nothing to do</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Type above and press Enter to add your first item.
          </p>
        </div>
      ) : (
        view.open.length > 0 && (
          // An explicit id: dnd-kit's generated aria ids otherwise differ between
          // server and browser render (see Board.tsx).
          <DndContext id="todo-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={view.open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul
                aria-label="Open to-dos"
                className="overflow-hidden rounded-xl bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200"
              >
                {view.open.map((item) => (
                  <SortableTodoItem key={item.id} item={item} timezone={timezone} {...handlers} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )
      )}

      {view.done.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls="todo-completed"
            onClick={() => setShowDone((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-label-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
          >
            <IconChevronRight
              className={cn('size-4 transition-transform duration-150', showDone && 'rotate-90')}
              aria-hidden="true"
            />
            Completed ({view.done.length})
          </button>
          {showDone && (
            <ul
              id="todo-completed"
              aria-label="Completed to-dos"
              className="mt-2 overflow-hidden rounded-xl bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200"
            >
              {view.done.map((item) => (
                <TodoItem
                  key={item.id}
                  item={item}
                  timezone={timezone}
                  // Keeps the title column aligned with the open list's handle.
                  handle={<span className="size-9 shrink-0" aria-hidden="true" />}
                  {...handlers}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
