import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { byId, byKey, positionBetween, positionsAfter, positionsForCount } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { MAX_SUBTASK_BATCH } from '@/lib/subtasks';
import { recordActivity } from '@/server/activity/service';
import { emitChange } from '@/server/changes/service';
import { notifyTaskChange } from '@/server/notifications/changes';
import { lastTaskPosition, lockColumns } from '@/server/tasks/columns';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks a parent for the rest of the transaction, so writes that place its
 * subtasks run one at a time and each reads the keys the previous one left (as
 * lockColumns does for board columns). NO KEY UPDATE does not block the
 * key-share lock that inserting a child referencing it takes. False when the
 * parent is gone.
 */
export async function lockParent(tx: Tx, parentId: string): Promise<boolean> {
  const rows = await tx.select({ id: task.id }).from(task).where(eq(task.id, parentId)).for('no key update');
  return rows.length > 0;
}

/** The parent's last subtask key, or null when it has none. Read after lockParent. */
export async function lastSubtaskPosition(tx: Tx, parentId: string): Promise<string | null> {
  const [last] = await tx
    .select({ p: task.subtaskPosition })
    .from(task)
    .where(and(eq(task.parentTaskId, parentId), isNull(task.archivedAt)))
    .orderBy(desc(byKey(task.subtaskPosition)))
    .limit(1);
  return last?.p ?? null;
}

const STALE_REORDER = 'The list changed while you were dragging. Try again.';
const INVALID_MOVE = 'That move is not valid.';

/** A top-level, unarchived task of this workspace in an active project, or null. */
async function loadParent(ctx: WorkspaceContext, parentId: string) {
  const [row] = await db
    .select({ id: task.id, projectId: task.projectId, statusId: task.statusId, title: task.title, isDone: taskStatus.isDone })
    .from(task)
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
    .where(and(
      eq(task.id, parentId), eq(task.workspaceId, ctx.workspaceId),
      isNull(task.parentTaskId), isNull(task.archivedAt),
    ))
    .limit(1);
  return row ?? null;
}

const createSubtasksSchema = z.object({
  parentTaskId: z.string().min(1),
  titles: z.array(z.string()),
});

export type CreateSubtasksInput = z.input<typeof createSubtasksSchema>;

/**
 * Several subtasks at once, from a multi-line paste. All or nothing, appended
 * after the last sibling in the order given, each in the parent's column (as
 * a single add puts it).
 */
export async function createSubtasks(
  ctx: WorkspaceContext,
  input: CreateSubtasksInput,
): Promise<Result<{ ids: string[] }>> {
  return withAction(async () => {
    const parsed = createSubtasksSchema.safeParse(input);
    if (!parsed.success) return err('Those subtasks are not valid.');
    const titles = parsed.data.titles.map((t) => t.trim()).filter((t) => t.length > 0);
    if (titles.length === 0) return err('Give the subtask a title.');
    if (titles.length > MAX_SUBTASK_BATCH) return err('Up to 50 at a time.');
    if (titles.some((t) => t.length > 200)) return err('Title is too long.');

    const parent = await loadParent(ctx, parsed.data.parentTaskId);
    if (!parent) return err('Parent task not found.');

    return db.transaction(async (tx) => {
      if (!(await lockColumns(tx, [parent.statusId]))) return err('That column no longer exists.');
      if (!(await lockParent(tx, parent.id))) return err('Parent task not found.');
      const boardKeys = positionsAfter(await lastTaskPosition(tx, parent.projectId, parent.statusId), titles.length);
      const subKeys = positionsAfter(await lastSubtaskPosition(tx, parent.id), titles.length);
      const ids = titles.map(() => newId());
      const now = new Date();

      await tx.insert(task).values(titles.map((title, i) => ({
        id: ids[i],
        workspaceId: ctx.workspaceId,
        projectId: parent.projectId,
        title,
        statusId: parent.statusId,
        parentTaskId: parent.id,
        position: boardKeys[i],
        subtaskPosition: subKeys[i],
        createdBy: ctx.userId,
        completedAt: parent.isDone ? now : null,
      })));
      for (let i = 0; i < ids.length; i++) {
        await recordActivity(ctx, { taskId: ids[i], kind: 'created', to: titles[i] }, tx);
      }
      await emitChange(ctx, { projectId: parent.projectId }, tx);
      return ok({ ids });
    });
  });
}

const reorderSchema = z.object({
  taskId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type ReorderSubtaskInput = z.input<typeof reorderSchema>;

/**
 * A subtask drag. As with moveTask, the client sends neighbours and the server
 * computes the key under the parent's lock, so two concurrent drags cannot
 * land on the same key.
 */
export async function reorderSubtask(
  ctx: WorkspaceContext,
  input: ReorderSubtaskInput,
): Promise<Result<{ subtaskPosition: string }>> {
  return withAction(async () => {
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return err(INVALID_MOVE);
    const { taskId, beforeId, afterId } = parsed.data;

    const [owned] = await db
      .select({ id: task.id, parentId: task.parentTaskId, projectId: task.projectId })
      .from(task)
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
      .limit(1);
    if (!owned) return err('Task not found.');
    if (!owned.parentId) return err('Only subtasks can be reordered here.');
    const parentId = owned.parentId;

    return db.transaction(async (tx) => {
      if (!(await lockParent(tx, parentId))) return err('Parent task not found.');

      // null = list edge; undefined = not a valid neighbour (self, archived, another parent).
      const neighbour = async (id: string | null): Promise<string | null | undefined> => {
        if (id === null) return null;
        if (id === taskId) return undefined;
        const [row] = await tx
          .select({ p: task.subtaskPosition })
          .from(task)
          .where(and(eq(task.id, id), eq(task.parentTaskId, parentId), isNull(task.archivedAt)))
          .limit(1);
        return row ? row.p : undefined;
      };

      const before = await neighbour(beforeId);
      const after = await neighbour(afterId);
      if (before === undefined || after === undefined) return err(INVALID_MOVE);
      if (before !== null && after !== null) {
        if (before > after) return err(STALE_REORDER);
        if (before === after && beforeId! > afterId!) return err(STALE_REORDER);
      }

      let key: string;
      if (before !== null && before === after) {
        // Tied keys (left by the backfill): renumber the siblings in displayed
        // order, then place between the new keys.
        const siblings = await tx
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.parentTaskId, parentId), isNull(task.archivedAt), ne(task.id, taskId)))
          .orderBy(byKey(task.subtaskPosition), byId(task.id));
        const keys = positionsForCount(siblings.length);
        const renumbered = new Map(siblings.map((s, i) => [s.id, keys[i]]));
        for (const [id, k] of renumbered) {
          await tx.update(task).set({ subtaskPosition: k }).where(eq(task.id, id));
        }
        key = positionBetween(renumbered.get(beforeId!)!, renumbered.get(afterId!)!);
      } else {
        // Against the sibling right after `before` now, not the one the client
        // saw: a concurrent drop into the same gap may have landed since.
        const [next] = await tx
          .select({ p: task.subtaskPosition })
          .from(task)
          .where(and(
            eq(task.parentTaskId, parentId), isNull(task.archivedAt), ne(task.id, taskId),
            before === null ? undefined : gt(byKey(task.subtaskPosition), before),
          ))
          .orderBy(byKey(task.subtaskPosition))
          .limit(1);
        // Dropped at the end: nothing after it, whatever sorts after `before`.
        key = positionBetween(before, afterId === null ? null : next?.p ?? null);
      }

      await tx.update(task).set({ subtaskPosition: key, updatedAt: new Date() }).where(eq(task.id, taskId));
      // A reorder is not history, as for board drags.
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ subtaskPosition: key });
    });
  });
}

const setParentSchema = z.object({
  taskId: z.string().min(1),
  parentTaskId: z.string().min(1).nullable(),
});

export type SetTaskParentInput = z.input<typeof setParentSchema>;

/**
 * Makes a task a subtask of another (parentTaskId set) or promotes a subtask
 * to a top-level task (null). Depth stays one: the new parent must be
 * top-level and the task must have no subtasks of its own.
 */
export async function setTaskParent(
  ctx: WorkspaceContext,
  input: SetTaskParentInput,
): Promise<Result<{ previousParentId: string | null }>> {
  return withAction(async () => {
    const parsed = setParentSchema.safeParse(input);
    if (!parsed.success) return err('That change is not valid.');
    const { taskId, parentTaskId } = parsed.data;

    const parentAlias = alias(task, 'old_parent');
    const [owned] = await db
      .select({
        id: task.id, projectId: task.projectId, statusId: task.statusId,
        parentId: task.parentTaskId, parentTitle: parentAlias.title,
      })
      .from(task)
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .leftJoin(parentAlias, eq(parentAlias.id, task.parentTaskId))
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
      .limit(1);
    if (!owned) return err('Task not found.');
    if (owned.parentId === parentTaskId) return ok({ previousParentId: owned.parentId });

    let newParentTitle: string | null = null;
    if (parentTaskId) {
      if (parentTaskId === taskId) return err('A task can’t be its own subtask.');
      const parent = await loadParent(ctx, parentTaskId);
      if (!parent || parent.projectId !== owned.projectId) return err('Parent task not found.');
      newParentTitle = parent.title;
      const [child] = await db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.parentTaskId, taskId), isNull(task.archivedAt)))
        .limit(1);
      if (child) return err('Tasks with subtasks can’t become subtasks.');
    }

    return db.transaction(async (tx) => {
      if (parentTaskId) {
        if (!(await lockParent(tx, parentTaskId))) return err('Parent task not found.');
        const key = positionBetween(await lastSubtaskPosition(tx, parentTaskId), null);
        await tx.update(task)
          .set({ parentTaskId, subtaskPosition: key, updatedAt: new Date() })
          .where(eq(task.id, taskId));
      } else {
        // A fresh board key at the column's end: the old one was only ever
        // compared with siblings' keys and could tie with a board card's.
        if (!(await lockColumns(tx, [owned.statusId]))) return err('That column no longer exists.');
        const last = await lastTaskPosition(tx, owned.projectId, owned.statusId);
        await tx.update(task)
          .set({ parentTaskId: null, subtaskPosition: null, position: positionBetween(last, null), updatedAt: new Date() })
          .where(eq(task.id, taskId));
      }
      await recordActivity(ctx, { taskId, kind: 'parent', from: owned.parentTitle, to: newParentTitle }, tx);
      await notifyTaskChange(ctx, tx, { taskId, changes: ['parent'] });
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ previousParentId: owned.parentId });
    });
  });
}
