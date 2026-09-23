import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, task, taskStatus, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { recordActivity, type ActivityKind } from '@/server/activity/service';

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

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

/** Member names, for activity rows that must survive the member being removed. */
async function memberName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.name ?? null;
}

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the task a title.').max(200, 'Title is too long.'),
  statusId: z.string().optional(),
  parentTaskId: z.string().optional(),
});

export async function createTask(
  ctx: WorkspaceContext,
  input: { projectId: string; title: string; statusId?: string; parentTaskId?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    if (!(await assertProject(ctx, parsed.data.projectId))) return err('Project not found.');

    // Default to the leftmost column.
    let statusId = parsed.data.statusId;
    if (statusId) {
      if (!(await assertStatus(ctx, statusId, parsed.data.projectId))) {
        return err('That column does not belong to this project.');
      }
    } else {
      const [first] = await db
        .select({ id: taskStatus.id })
        .from(taskStatus)
        .where(eq(taskStatus.projectId, parsed.data.projectId))
        .orderBy(asc(taskStatus.position))
        .limit(1);
      if (!first) return err('This project has no columns.');
      statusId = first.id;
    }

    const [last] = await db
      .select({ position: task.position })
      .from(task)
      .where(and(eq(task.projectId, parsed.data.projectId), eq(task.statusId, statusId)))
      .orderBy(desc(task.position))
      .limit(1);

    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(task).values({
        id,
        // From the context, never the input: this is what keeps the denormalized
        // column honest (spec §3.3).
        workspaceId: ctx.workspaceId,
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        statusId,
        parentTaskId: parsed.data.parentTaskId,
        position: positionBetween(last?.position ?? null, null),
        createdBy: ctx.userId,
      });
      await recordActivity(ctx, { taskId: id, kind: 'created', to: parsed.data.title }, tx);
    });

    return ok({ id });
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
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.').nullable().optional(),
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
      entries.push({
        kind: 'assignee',
        from: await memberName(owned.assigneeId),
        to: await memberName(patch.assigneeId as string | null),
      });
    }
    if (patch.statusId !== undefined && patch.statusId !== owned.statusId) {
      entries.push({ kind: 'status', from: owned.statusName, to: newStatusName });
    }

    await db.transaction(async (tx) => {
      await tx.update(task).set(patch).where(eq(task.id, parsed.data.taskId));
      for (const entry of entries) {
        await recordActivity(ctx, { taskId: parsed.data.taskId, ...entry }, tx);
      }
    });

    return ok(null);
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

    const neighbourPosition = async (id: string | null) => {
      if (!id) return null;
      const [row] = await db
        .select({ position: task.position })
        .from(task)
        .where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId)))
        .limit(1);
      return row?.position ?? null;
    };

    const [before, after] = await Promise.all([
      neighbourPosition(parsed.data.beforeId),
      neighbourPosition(parsed.data.afterId),
    ]);

    const position = positionBetween(before, after);

    const crossedColumn = parsed.data.statusId !== owned.statusId;

    await db.transaction(async (tx) => {
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
    });

    return ok({ position });
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
