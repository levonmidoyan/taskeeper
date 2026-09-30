import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, todo } from '@/db';
import { byId, byKey } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';

export type TodoRow = {
  id: string;
  title: string;
  dueDate: string | null;
  completedAt: Date | null;
};

export type TodoLists = { open: TodoRow[]; done: TodoRow[] };

/**
 * The caller's own items in this workspace. Both ids, always: the workspace id
 * alone would show every member's list, and the user id alone would mix a
 * member's workspaces together.
 */
export const ownedBy = (ctx: WorkspaceContext) =>
  and(eq(todo.userId, ctx.userId), eq(todo.workspaceId, ctx.workspaceId));

const columns = {
  id: todo.id,
  title: todo.title,
  dueDate: todo.dueDate,
  completedAt: todo.completedAt,
};

/** Open items in the user's order; done items most recently completed first. */
export async function listTodos(ctx: WorkspaceContext): Promise<TodoLists> {
  const [open, done] = await Promise.all([
    db.select(columns).from(todo)
      .where(and(ownedBy(ctx), isNull(todo.completedAt)))
      .orderBy(byKey(todo.position), byId(todo.id)),
    db.select(columns).from(todo)
      .where(and(ownedBy(ctx), isNotNull(todo.completedAt)))
      .orderBy(desc(todo.completedAt), byId(todo.id)),
  ]);
  return { open, done };
}
