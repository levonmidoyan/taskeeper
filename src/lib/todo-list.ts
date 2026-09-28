import { arrayMove } from '@dnd-kit/sortable';
import type { TodoLists, TodoRow } from '@/server/todos/queries';

/**
 * Client-side mirrors of the todo service, for useOptimistic. They only need to
 * match what the server will show after revalidation closely enough that the
 * swap is invisible: open items in list order, done items newest first, an
 * unchecked item at the end of open.
 */
export type TodoOp =
  | { kind: 'toggle'; id: string; done: boolean; now: Date }
  | { kind: 'move'; id: string; toIndex: number }
  | { kind: 'edit'; id: string; title?: string; dueDate?: string | null }
  | { kind: 'delete'; id: string };

export function applyTodoOp(lists: TodoLists, op: TodoOp): TodoLists {
  switch (op.kind) {
    case 'toggle': {
      const from = op.done ? lists.open : lists.done;
      const item = from.find((t) => t.id === op.id);
      if (!item) return lists;
      const rest = from.filter((t) => t.id !== op.id);
      return op.done
        ? { open: rest, done: [{ ...item, completedAt: op.now }, ...lists.done] }
        : { open: [...lists.open, { ...item, completedAt: null }], done: rest };
    }
    case 'move': {
      const from = lists.open.findIndex((t) => t.id === op.id);
      if (from === -1) return lists;
      return { ...lists, open: arrayMove(lists.open, from, op.toIndex) };
    }
    case 'edit': {
      const patch = (t: TodoRow): TodoRow =>
        t.id !== op.id
          ? t
          : {
              ...t,
              ...(op.title !== undefined && { title: op.title }),
              ...(op.dueDate !== undefined && { dueDate: op.dueDate }),
            };
      return { open: lists.open.map(patch), done: lists.done.map(patch) };
    }
    case 'delete':
      return {
        open: lists.open.filter((t) => t.id !== op.id),
        done: lists.done.filter((t) => t.id !== op.id),
      };
  }
}

/**
 * Where a dragged item lands when dropped on another, in the shape moveTodo
 * needs: neighbour ids, never a position, so the server computes the key.
 */
export function dropTarget(ids: string[], activeId: string, overId: string) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;

  const next = arrayMove(ids, from, to);
  return {
    toIndex: to,
    beforeId: next[to - 1] ?? null,
    afterId: next[to + 1] ?? null,
  };
}
