import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, label, member, project, task, taskLabel, taskStatus, user } from '@/db';
import { newId } from '@/lib/ids';
import { byId, byKey, positionBetween, positionsForCount } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { recordActivity, type ActivityKind } from '@/server/activity/service';
import { lastTaskPosition, lockColumns, nextTaskPosition } from '@/server/tasks/columns';

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

const STALE_MOVE = 'The board changed while you were dragging. Try again.';
const COLUMN_GONE = 'That column no longer exists.';

/** Confirms a project belongs to this workspace. Every task write starts here. */
async function assertProject(ctx: WorkspaceContext, projectId: string) {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Confirms a status belongs to a project that belongs to this workspace. */
async function assertStatus(ctx: WorkspaceContext, statusId: string, projectId: string) {
  const [row] = await db
    .select({ id: taskStatus.id, isDone: taskStatus.isDone, name: taskStatus.name })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    .where(
      and(
        eq(taskStatus.id, statusId),
        eq(taskStatus.projectId, projectId),
        eq(project.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadOwnedTask(ctx: WorkspaceContext, taskId: string) {
  const [row] = await db
    .select({
      id: task.id, projectId: task.projectId, statusId: task.statusId,
      completedAt: task.completedAt, title: task.title, priority: task.priority,
      assigneeId: task.assigneeId, dueDate: task.dueDate,
      statusName: taskStatus.name,
    })
    .from(task)
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

/**
 * Member names, for activity rows that must survive the member being removed.
 * Scoped to this workspace's membership: an id outside it (whether a stale
 * assignee or an unvalidated one) resolves to null rather than disclosing a
 * stranger's name across tenants.
 */
async function memberName(ctx: WorkspaceContext, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, ctx.workspaceId)))
    .where(eq(user.id, userId))
    .limit(1);
  return row?.name ?? null;
}

const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the task a title.').max(200, 'Title is too long.'),
  statusId: z.string().optional(),
  parentTaskId: z.string().optional(),
  // The rest is what the full create form can fill in up front.
  description: z.string().max(10_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  labelIds: z.array(z.string()).max(20).optional(),
});

export type CreateTaskInput = z.input<typeof createSchema>;

export async function createTask(
  ctx: WorkspaceContext,
  input: CreateTaskInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    if (!(await assertProject(ctx, parsed.data.projectId))) return err('Project not found.');

    // Default to the leftmost column.
    let statusId = parsed.data.statusId;
    let isDone = false;
    if (statusId) {
      const status = await assertStatus(ctx, statusId, parsed.data.projectId);
      if (!status) return err('That column does not belong to this project.');
      isDone = status.isDone;
    } else {
      const [first] = await db
        .select({ id: taskStatus.id })
        .from(taskStatus)
        .where(eq(taskStatus.projectId, parsed.data.projectId))
        .orderBy(byKey(taskStatus.position))
        .limit(1);
      if (!first) return err('This project has no columns.');
      statusId = first.id;
    }

    const assigneeId = parsed.data.assigneeId ?? null;
    if (assigneeId && !(await memberName(ctx, assigneeId))) return err('That person is not in this workspace.');

    // A subtask lives on its parent's board, so the parent must be in the same
    // project — which also keeps it inside this workspace.
    const parentTaskId = parsed.data.parentTaskId ?? null;
    if (parentTaskId) {
      const [parent] = await db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.id, parentTaskId),
            eq(task.projectId, parsed.data.projectId),
            eq(task.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);
      if (!parent) return err('Parent task not found.');
    }

    // Deduplicated, then every id must belong to this workspace (as setTaskLabels).
    const labelIds = [...new Set(parsed.data.labelIds ?? [])];
    if (labelIds.length > 0) {
      const valid = await db
        .select({ id: label.id })
        .from(label)
        .where(and(eq(label.workspaceId, ctx.workspaceId), inArray(label.id, labelIds)));
      if (valid.length !== labelIds.length) return err('Unknown label.');
    }

    const id = newId();
    return db.transaction(async (tx) => {
      // The last key is read under the column lock, so concurrent creates in one
      // column append one after another instead of sharing a key.
      if (!(await lockColumns(tx, [statusId]))) return err(COLUMN_GONE);
      const last = await lastTaskPosition(tx, parsed.data.projectId, statusId);

      await tx.insert(task).values({
        id,
        // From the context, never the input: this is what keeps the denormalized
        // column honest (spec §3.3).
        workspaceId: ctx.workspaceId,
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        statusId,
        parentTaskId,
        position: positionBetween(last, null),
        createdBy: ctx.userId,
        description: parsed.data.description,
        priority: parsed.data.priority,
        assigneeId,
        dueDate: parsed.data.dueDate ?? null,
        completedAt: isDone ? new Date() : null,
      });
      if (labelIds.length > 0) {
        await tx.insert(taskLabel).values(labelIds.map((labelId) => ({ taskId: id, labelId })));
      }
      await recordActivity(ctx, { taskId: id, kind: 'created', to: parsed.data.title }, tx);
      return ok({ id });
    });
  });
}

export const updateSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the task a title.').max(200).optional(),
  description: z.string().max(10_000).optional(),
  statusId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  // A calendar date, never an instant (spec §3.4).
  dueDate: dueDateSchema.nullable().optional(),
});

export type UpdateTaskInput = z.input<typeof updateSchema>;

export async function updateTask(
  ctx: WorkspaceContext,
  input: UpdateTaskInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const owned = await loadOwnedTask(ctx, parsed.data.taskId);
    if (!owned) return err('Task not found.');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.dueDate !== undefined) patch.dueDate = parsed.data.dueDate;

    let newStatusName: string | null = null;
    if (parsed.data.statusId !== undefined) {
      const status = await assertStatus(ctx, parsed.data.statusId, owned.projectId);
      if (!status) return err('That column does not belong to this project.');
      patch.statusId = parsed.data.statusId;
      newStatusName = status.name;
      // completed_at follows the column's is_done flag in both directions.
      patch.completedAt = status.isDone ? (owned.completedAt ?? new Date()) : null;
    }

    const entries: { kind: ActivityKind; from?: string | null; to?: string | null }[] = [];

    if (patch.title !== undefined && patch.title !== owned.title) {
      entries.push({ kind: 'title', from: owned.title, to: patch.title as string });
    }
    if (patch.priority !== undefined && patch.priority !== owned.priority) {
      entries.push({ kind: 'priority', from: owned.priority, to: patch.priority as string });
    }
    if (patch.dueDate !== undefined && patch.dueDate !== owned.dueDate) {
      entries.push({ kind: 'due_date', from: owned.dueDate, to: patch.dueDate as string | null });
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== owned.assigneeId) {
      // Only a change is checked, so a stale assignee (since removed from the
      // workspace) does not block edits to other fields.
      const to = await memberName(ctx, patch.assigneeId as string | null);
      if (patch.assigneeId !== null && !to) return err('That person is not in this workspace.');
      entries.push({ kind: 'assignee', from: await memberName(ctx, owned.assigneeId), to });
    }
    if (patch.statusId !== undefined && patch.statusId !== owned.statusId) {
      entries.push({ kind: 'status', from: owned.statusName, to: newStatusName });
    }

    return db.transaction(async (tx) => {
      // A task changing column goes to its end. Keeping its old key could tie
      // with a task already there, since each column numbers its own keys.
      if (patch.statusId !== undefined && patch.statusId !== owned.statusId) {
        if (!(await lockColumns(tx, [patch.statusId as string]))) return err(COLUMN_GONE);
        const last = await lastTaskPosition(tx, owned.projectId, patch.statusId as string);
        patch.position = positionBetween(last, null);
      }

      await tx.update(task).set(patch).where(eq(task.id, parsed.data.taskId));
      for (const entry of entries) {
        await recordActivity(ctx, { taskId: parsed.data.taskId, ...entry }, tx);
      }
      return ok(null);
    });
  });
}

export const moveSchema = z.object({
  taskId: z.string().min(1),
  statusId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type MoveTaskInput = z.input<typeof moveSchema>;

/**
 * The board drop. The client sends neighbours, not a position: the server computes
 * the key, so two concurrent drags cannot agree on the same one.
 */
export async function moveTask(
  ctx: WorkspaceContext,
  input: MoveTaskInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return err('That move is not valid.');

    const owned = await loadOwnedTask(ctx, parsed.data.taskId);
    if (!owned) return err('Task not found.');

    const status = await assertStatus(ctx, parsed.data.statusId, owned.projectId);
    if (!status) return err('That column does not belong to this project.');

    const crossedColumn = parsed.data.statusId !== owned.statusId;

    return db.transaction(async (tx) => {
      // Neighbours are read under the column lock: two drops into one gap that
      // both read its keys first would compute the same key between them.
      if (!(await lockColumns(tx, [parsed.data.statusId]))) return err(COLUMN_GONE);

      // null = column edge; undefined = not a valid neighbour. Scoped to the target
      // column: a key computed from anywhere else sorts the task into a nonsense place.
      const neighbourPosition = async (id: string | null): Promise<string | null | undefined> => {
        if (id === null) return null;
        if (id === owned.id) return undefined;
        const [row] = await tx
          .select({ position: task.position })
          .from(task)
          .where(
            and(
              eq(task.id, id),
              eq(task.statusId, parsed.data.statusId),
              eq(task.workspaceId, ctx.workspaceId),
            ),
          )
          .limit(1);
        return row?.position;
      };

      const before = await neighbourPosition(parsed.data.beforeId);
      const after = await neighbourPosition(parsed.data.afterId);
      if (before === undefined || after === undefined) return err('That move is not valid.');
      // Reversed neighbours mean someone reordered the column since this board loaded.
      // Tied keys are ordered by id (codepoint, as the board query sorts them).
      if (before !== null && after !== null) {
        if (before > after) return err(STALE_MOVE);
        if (before === after && parsed.data.beforeId! > parsed.data.afterId!) return err(STALE_MOVE);
      }

      let position: string;
      if (before !== null && before === after) {
        // Two tasks share a key (left by writes from before columns were locked),
        // so nothing fits between them. Renumber the column in its
        // displayed order, then place the task between the new keys.
        const column = await tx
          .select({ id: task.id })
          .from(task)
          .where(
            and(
              eq(task.projectId, owned.projectId),
              eq(task.statusId, parsed.data.statusId),
              ne(task.id, owned.id),
            ),
          )
          .orderBy(byKey(task.position), byId(task.id));
        const keys = positionsForCount(column.length);
        const renumbered = new Map(column.map((row, i) => [row.id, keys[i]]));
        for (const [id, key] of renumbered) {
          await tx.update(task).set({ position: key }).where(eq(task.id, id));
        }
        position = positionBetween(
          renumbered.get(parsed.data.beforeId!)!,
          renumbered.get(parsed.data.afterId!)!,
        );
      } else {
        position = positionBetween(
          before,
          await nextTaskPosition(tx, owned.projectId, parsed.data.statusId, before, owned.id),
        );
      }

      await tx
        .update(task)
        .set({
          statusId: parsed.data.statusId,
          position,
          completedAt: status.isDone ? (owned.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(task.id, parsed.data.taskId));

      // A reorder inside one column is not history — recording it would bury the
      // feed under every drag.
      if (crossedColumn) {
        await recordActivity(
          ctx,
          { taskId: parsed.data.taskId, kind: 'status', from: owned.statusName, to: status.name },
          tx,
        );
      }
      return ok({ position });
    });
  });
}

export async function deleteTask(
  ctx: WorkspaceContext,
  input: { taskId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const owned = await loadOwnedTask(ctx, input.taskId);
    if (!owned) return err('Task not found.');

    // Subtasks cascade on parent_task_id, so one delete is enough.
    await db.delete(task).where(eq(task.id, input.taskId));

    return ok(null);
  });
}

const taskIdsSchema = z.array(z.string().min(1)).min(1, 'Select at least one task.').max(200, 'Select at most 200 tasks.');

const bulkUpdateSchema = z.object({
  taskIds: taskIdsSchema,
  // Title, description and assignee are per-task decisions; these fan out.
  patch: updateSchema
    .pick({ statusId: true, priority: true, dueDate: true })
    .refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to change.'),
});

export type BulkUpdateTasksInput = z.input<typeof bulkUpdateSchema>;

/**
 * The list view's bulk bar. Runs each task through updateTask so every row gets
 * the same validation, completed_at handling and activity entries as a single
 * edit. Ownership is checked for the whole set up front, so a foreign id fails
 * the call before any task is touched.
 */
export async function bulkUpdateTasks(
  ctx: WorkspaceContext,
  input: BulkUpdateTasksInput,
): Promise<Result<{ updated: number }>> {
  return withAction(async () => {
    const parsed = bulkUpdateSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const ids = [...new Set(parsed.data.taskIds)];
    const owned = await db
      .select({ id: task.id })
      .from(task)
      .where(and(inArray(task.id, ids), eq(task.workspaceId, ctx.workspaceId)));
    if (owned.length !== ids.length) return err('Some of those tasks were not found.');

    for (const taskId of ids) {
      const result = await updateTask(ctx, { taskId, ...parsed.data.patch });
      if (!result.ok) return result;
    }

    return ok({ updated: ids.length });
  });
}

export async function bulkDeleteTasks(
  ctx: WorkspaceContext,
  input: { taskIds: string[] },
): Promise<Result<{ deleted: number }>> {
  return withAction(async () => {
    const parsed = taskIdsSchema.safeParse(input.taskIds);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    // Scoped by workspace in the WHERE, so a foreign id simply matches nothing.
    const deleted = await db
      .delete(task)
      .where(and(inArray(task.id, parsed.data), eq(task.workspaceId, ctx.workspaceId)))
      .returning({ id: task.id });

    return ok({ deleted: deleted.length });
  });
}
