import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { comment, db, label, project, task, taskActivity, taskLabel, taskStatus, user } from '@/db';
import { isOverdue } from '@/lib/dates';
import { byId, byKey } from '@/lib/position';
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
  assigneeImage: string | null;
  dueDate: string | null;
  position: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  assigneeImage: user.image,
  dueDate: task.dueDate,
  position: task.position,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
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
    .orderBy(byKey(task.position), byId(task.id));

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
  projectId: string;
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
    .select({
      ...baseColumns,
      projectId: task.projectId,
      parentId: task.parentTaskId,
      parentTitle: parent.title,
    })
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
    .orderBy(byKey(task.position), byId(task.id));

  return {
    ...withLabels,
    projectId: rows[0].projectId,
    parentId: rows[0].parentId,
    parentTitle: rows[0].parentTitle,
    subtasks: await attachLabels(subtaskRows),
  };
}

export async function listMyOpenTasks(
  ctx: WorkspaceContext,
): Promise<(TaskRow & { projectId: string; projectName: string; projectColor: string; overdue: boolean })[]> {
  const rows = await db
    // projectId comes along so the caller can build a link back to the task's
    // project; it is not on TaskRow because the board already knows its project.
    .select({ ...baseColumns, projectId: task.projectId, projectName: project.name, projectColor: project.color })
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
    .orderBy(sql`${task.dueDate} asc nulls last`, byKey(task.position), byId(task.id));

  const enriched = await attachLabels(rows);

  return enriched.map((row, i) => ({
    ...row,
    projectId: rows[i].projectId,
    projectName: rows[i].projectName,
    projectColor: rows[i].projectColor,
    // Overdue is computed in the workspace zone, never from the server clock (spec §3.4).
    overdue: row.dueDate ? isOverdue(row.dueDate, ctx.timezone) : false,
  }));
}

/** Statuses of a project, board order. Guarded by workspace so a stray id cannot leak columns. */
export async function listStatuses(ctx: WorkspaceContext, projectId: string) {
  return db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone, icon: taskStatus.icon,
    })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    .where(and(eq(taskStatus.projectId, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .orderBy(byKey(taskStatus.position), byId(taskStatus.id));
}

export type TaskSearchHit = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  completed: boolean;
};

/**
 * Title substring match across the workspace, for the header search. Open work
 * ranks first, then recently updated. LIKE wildcards in the term are escaped so
 * "50%" searches for the literal text.
 */
export async function searchTasks(
  ctx: WorkspaceContext,
  term: string,
  limit = 8,
): Promise<TaskSearchHit[]> {
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      projectName: project.name,
      projectColor: project.color,
      completedAt: task.completedAt,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(project.archivedAt),
        ilike(task.title, pattern),
      ),
    )
    .orderBy(sql`${task.completedAt} is not null`, desc(task.updatedAt))
    .limit(limit);

  return rows.map(({ completedAt, ...r }) => ({ ...r, completed: completedAt !== null }));
}

export type RecentTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  priority: Priority;
  dueDate: string | null;
  completed: boolean;
  /** Last time the caller created, changed or commented on the task. */
  touchedAt: Date;
};

/**
 * Tasks the caller recently worked on, newest first: ones they created,
 * changed or commented on. Derived from the activity and comment history, so
 * nothing extra is written as people browse. Every source filters on
 * workspace_id, and archived tasks and projects drop out.
 */
export async function listRecentTasks(ctx: WorkspaceContext, limit = 30): Promise<RecentTask[]> {
  const touches = db
    .select({ taskId: taskActivity.taskId, at: taskActivity.createdAt })
    .from(taskActivity)
    .where(and(eq(taskActivity.workspaceId, ctx.workspaceId), eq(taskActivity.actorId, ctx.userId)))
    .unionAll(
      db
        .select({ taskId: comment.taskId, at: comment.createdAt })
        .from(comment)
        .where(and(eq(comment.workspaceId, ctx.workspaceId), eq(comment.authorId, ctx.userId))),
    )
    .unionAll(
      db
        .select({ taskId: task.id, at: task.createdAt })
        .from(task)
        .where(and(eq(task.workspaceId, ctx.workspaceId), eq(task.createdBy, ctx.userId))),
    )
    .as('touches');

  const latest = db
    .select({ taskId: touches.taskId, touchedAt: sql<Date>`max(${touches.at})`.as('touched_at') })
    .from(touches)
    .groupBy(touches.taskId)
    .as('latest');

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      projectName: project.name,
      projectColor: project.color,
      priority: task.priority,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
      touchedAt: latest.touchedAt,
    })
    .from(latest)
    .innerJoin(task, and(eq(task.id, latest.taskId), eq(task.workspaceId, ctx.workspaceId)))
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(isNull(task.archivedAt), isNull(project.archivedAt)))
    .orderBy(desc(latest.touchedAt))
    .limit(limit);

  return rows.map(({ completedAt, touchedAt, ...r }) => ({
    ...r,
    completed: completedAt !== null,
    // A raw aggregate comes back from pg as a string, not through the column's mapper.
    touchedAt: new Date(touchedAt),
  }));
}
