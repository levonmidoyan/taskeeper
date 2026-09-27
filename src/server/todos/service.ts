import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, todo } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { ownedBy } from './queries';

/**
 * A personal checklist, so there is no requireRole anywhere: the owner is the
 * only reader and writer, and ownedBy() is in every WHERE. A row that exists
 * but belongs to someone else is reported exactly like a missing one.
 */

const NOT_FOUND = 'To-do not found.';
const BAD_MOVE = 'That move is not valid.';

const titleSchema = z
  .string().trim().min(1, 'Name the to-do.').max(200, 'Keep it under 200 characters.');

/** 'YYYY-MM-DD' that is also a real calendar day — Postgres would throw on 2026-02-30. */
const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'That date is not valid.')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'That date is not valid.')
  .nullable();

async function lastOpenPosition(ctx: WorkspaceContext): Promise<string | null> {
  const [last] = await db
    .select({ position: todo.position })
    .from(todo)
    .where(and(ownedBy(ctx), isNull(todo.completedAt)))
    .orderBy(desc(todo.position))
    .limit(1);
  return last?.position ?? null;
}

export const createTodoSchema = z.object({
  title: titleSchema,
  dueDate: dueDateSchema.optional(),
});

export type CreateTodoInput = z.input<typeof createTodoSchema>;

/** Appends to the end of the open list. */
export async function createTodo(
  ctx: WorkspaceContext,
  input: CreateTodoInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = createTodoSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const id = newId();
    await db.insert(todo).values({
      id,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ?? null,
      position: positionBetween(await lastOpenPosition(ctx), null),
    });
    return ok({ id });
  });
}

export const updateTodoSchema = z.object({
  todoId: z.string().min(1),
  title: titleSchema.optional(),
  dueDate: dueDateSchema.optional(),
  done: z.boolean().optional(),
});

export type UpdateTodoInput = z.input<typeof updateTodoSchema>;

/**
 * Renames, re-dates, or toggles done. Checking sets completed_at (kept if
 * already set, so a double click does not reshuffle Completed); unchecking
 * clears it and sends the item to the end of the open list.
 */
export async function updateTodo(
  ctx: WorkspaceContext,
  input: UpdateTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = updateTodoSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);
    const { todoId, title, dueDate, done } = parsed.data;

    const [current] = await db
      .select({ completedAt: todo.completedAt })
      .from(todo)
      .where(and(eq(todo.id, todoId), ownedBy(ctx)))
      .limit(1);
    if (!current) return err(NOT_FOUND);

    const patch: Partial<typeof todo.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (dueDate !== undefined) patch.dueDate = dueDate;
    if (done === true && !current.completedAt) patch.completedAt = new Date();
    if (done === false && current.completedAt) {
      patch.completedAt = null;
      patch.position = positionBetween(await lastOpenPosition(ctx), null);
    }

    await db.update(todo).set(patch).where(and(eq(todo.id, todoId), ownedBy(ctx)));
    return ok(null);
  });
}

export const moveTodoSchema = z.object({
  todoId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type MoveTodoInput = z.input<typeof moveTodoSchema>;

/**
 * Reorders an open item. As with a board drop, the client sends the neighbours
 * it saw and the server computes the key. Neighbours must be the caller's own
 * open items, and in order — anything else is a stale or forged move.
 */
export async function moveTodo(
  ctx: WorkspaceContext,
  input: MoveTodoInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const parsed = moveTodoSchema.safeParse(input);
    if (!parsed.success) return err(BAD_MOVE);
    const { todoId, beforeId, afterId } = parsed.data;

    const [moving] = await db
      .select({ completedAt: todo.completedAt })
      .from(todo)
      .where(and(eq(todo.id, todoId), ownedBy(ctx)))
      .limit(1);
    if (!moving) return err(NOT_FOUND);
    if (moving.completedAt) return err('Completed to-dos cannot be reordered.');

    // null = list edge; undefined = not a valid neighbour.
    const neighbour = async (id: string | null): Promise<string | null | undefined> => {
      if (id === null) return null;
      if (id === todoId) return undefined;
      const [row] = await db
        .select({ position: todo.position })
        .from(todo)
        .where(and(eq(todo.id, id), ownedBy(ctx), isNull(todo.completedAt)))
        .limit(1);
      return row?.position;
    };

    const [before, after] = await Promise.all([neighbour(beforeId), neighbour(afterId)]);
    if (before === undefined || after === undefined) return err(BAD_MOVE);
    // generateKeyBetween throws unless before < after.
    if (before !== null && after !== null && before >= after) return err(BAD_MOVE);

    const position = positionBetween(before, after);
    await db
      .update(todo)
      .set({ position, updatedAt: new Date() })
      .where(and(eq(todo.id, todoId), ownedBy(ctx)));
    return ok({ position });
  });
}

export const deleteTodoSchema = z.object({ todoId: z.string().min(1) });

export type DeleteTodoInput = z.input<typeof deleteTodoSchema>;

export async function deleteTodo(
  ctx: WorkspaceContext,
  input: DeleteTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = deleteTodoSchema.safeParse(input);
    if (!parsed.success) return err(NOT_FOUND);

    const deleted = await db
      .delete(todo)
      .where(and(eq(todo.id, parsed.data.todoId), ownedBy(ctx)))
      .returning({ id: todo.id });
    return deleted.length > 0 ? ok(null) : err(NOT_FOUND);
  });
}
