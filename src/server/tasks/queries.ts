import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, label, project, task, taskLabel, taskStatus, user } from '@/db';
import { isOverdue } from '@/lib/dates';
import type { WorkspaceContext } from '@/lib/session';

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type LabelRow = { id: string; name: string; color: string };

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  position: string;
  completedAt: Date | null;
  labels: LabelRow[];
  subtaskCount: number;
  subtaskDoneCount: number;
};

type BaseRow = Omit<TaskRow, 'labels' | 'subtaskCount' | 'subtaskDoneCount'>;

const baseColumns = {
  id: task.id,
  title: task.title,
  description: task.description,
  statusId: task.statusId,
  priority: task.priority,
  assigneeId: task.assigneeId,
  assigneeName: user.name,
  dueDate: task.dueDate,
  position: task.position,
  completedAt: task.completedAt,
};

async function attachLabels(rows: BaseRow[]): Promise<TaskRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const labelRows = await db
    .select({ taskId: taskLabel.taskId, id: label.id, name: label.name, color: label.color })
    .from(taskLabel)
    .innerJoin(label, eq(label.id, taskLabel.labelId))
    .where(inArray(taskLabel.taskId, ids));

  const subtaskRows = await db
    .select({
      parentId: task.parentTaskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${task.completedAt})::int`,
    })
    .from(task)
    .where(inArray(task.parentTaskId, ids))
    .groupBy(task.parentTaskId);

  const byTask = new Map(rows.map((r) => [r.id, [] as LabelRow[]]));
  for (const l of labelRows) byTask.get(l.taskId)?.push({ id: l.id, name: l.name, color: l.color });

  const counts = new Map(subtaskRows.map((s) => [s.parentId!, s]));

  return rows.map((r) => ({
    ...r,
    labels: byTask.get(r.id) ?? [],
    subtaskCount: counts.get(r.id)?.total ?? 0,
    subtaskDoneCount: counts.get(r.id)?.done ?? 0,
  }));
}

/** Top-level tasks of one project, board order. Subtasks are loaded with their parent. */
export async function listProjectTasks(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<TaskRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.projectId, projectId),
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.parentTaskId),
      ),
    )
    .orderBy(asc(task.position));

  return attachLabels(rows);
}

export async function getTask(ctx: WorkspaceContext, taskId: string): Promise<TaskRow | null> {
  const rows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);

  const [withLabels] = await attachLabels(rows);
  return withLabels ?? null;
}

export type TaskDetail = TaskRow & {
  parentId: string | null;
  parentTitle: string | null;
  subtasks: TaskRow[];
};

/**
 * One task plus what the detail dialog needs around it: its subtasks, and the
 * parent it hangs off so the dialog can offer a way back. Kept apart from
 * getTask so the board's list queries stay a single round trip.
 */
export async function getTaskDetail(
  ctx: WorkspaceContext,
  taskId: string,
): Promise<TaskDetail | null> {
  const parent = alias(task, 'parent_task');

  const rows = await db
    .select({ ...baseColumns, parentId: task.parentTaskId, parentTitle: parent.title })
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .leftJoin(parent, eq(parent.id, task.parentTaskId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);

  const [withLabels] = await attachLabels(rows);
  if (!withLabels) return null;

  const subtaskRows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.parentTaskId, taskId),
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
      ),
    )
    .orderBy(asc(task.position));

  return {
    ...withLabels,
    parentId: rows[0].parentId,
    parentTitle: rows[0].parentTitle,
    subtasks: await attachLabels(subtaskRows),
  };
}

export async function listMyOpenTasks(
  ctx: WorkspaceContext,
): Promise<(TaskRow & { projectId: string; projectName: string; overdue: boolean })[]> {
  const rows = await db
    // projectId comes along so the caller can build a link back to the task's
    // project; it is not on TaskRow because the board already knows its project.
    .select({ ...baseColumns, projectId: task.projectId, projectName: project.name })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        eq(task.assigneeId, ctx.userId),
        isNull(task.completedAt),
        isNull(task.archivedAt),
      ),
    )
    // Nulls last so undated work sinks below dated work.
    .orderBy(sql`${task.dueDate} asc nulls last`, asc(task.position));

  const enriched = await attachLabels(rows);

  return enriched.map((row, i) => ({
    ...row,
    projectId: rows[i].projectId,
    projectName: rows[i].projectName,
    // Overdue is computed in the workspace zone, never from the server clock (spec §3.4).
    overdue: row.dueDate ? isOverdue(row.dueDate, ctx.timezone) : false,
  }));
}

/** Statuses of a project, board order. Guarded by workspace so a stray id cannot leak columns. */
export async function listStatuses(ctx: WorkspaceContext, projectId: string) {
  return db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone,
    })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    .where(and(eq(taskStatus.projectId, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .orderBy(asc(taskStatus.position));
}
