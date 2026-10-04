import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { comment, db, label, project, task, taskActivity, taskLabel, taskStatus, user } from '@/db';
import { isOverdue } from '@/lib/dates';
import { MARK_END, MARK_START } from '@/lib/highlights';
import { byId, byKey } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';
import type { TaskFilter } from '@/lib/task-filter';
import type { TableSort } from '@/lib/task-table-sort';
import { taskFilterSql } from './filter';
import { likePattern, plainSnippet, toPrefixQuery } from './search-query';

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
  filter: TaskFilter = {},
): Promise<TaskRow[]> {
  const filters = await taskFilterSql(ctx, filter, 'project');
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
        ...filters,
      ),
    )
    .orderBy(byKey(task.position), byId(task.id));

  return attachLabels(rows);
}

export const WORKSPACE_TASK_LIMIT = 500;

export type WorkspaceTaskRow = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  statusName: string;
  statusColor: string;
  statusIcon: string | null;
  isDone: boolean;
  priority: Priority;
  assigneeName: string | null;
  assigneeImage: string | null;
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const PRIORITY_ORDER = sql`case ${task.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;

function workspaceOrder(sort: TableSort | null | undefined): SQL[] {
  if (!sort) return [sql`${task.dueDate} asc nulls last`, asc(task.createdAt), asc(task.id)];
  const dir = sql.raw(sort.desc ? 'desc' : 'asc');
  const key = {
    title: sql`lower(${task.title})`,
    status: sql`lower(${taskStatus.name})`,
    priority: PRIORITY_ORDER,
    assignee: sql`lower(${user.name})`,
    due: sql`${task.dueDate}`,
    created: sql`${task.createdAt}`,
    updated: sql`${task.updatedAt}`,
  }[sort.id];
  // Missing assignees and due dates sink to the bottom either way, as in the List.
  return [sql`${key} ${dir} nulls last`, asc(task.id)];
}

/**
 * Top-level tasks across every active project, for the All tasks page. Sorted
 * in SQL: with a row cap, sorting on the client would sort the wrong rows.
 */
export async function listWorkspaceTasks(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  opts: { sort?: TableSort | null; limit?: number } = {},
): Promise<{ tasks: WorkspaceTaskRow[]; truncated: boolean }> {
  const limit = opts.limit ?? WORKSPACE_TASK_LIMIT;
  const filters = await taskFilterSql(ctx, filter, 'workspace');
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
      statusName: taskStatus.name,
      statusColor: taskStatus.color,
      statusIcon: taskStatus.icon,
      isDone: taskStatus.isDone,
      priority: task.priority,
      assigneeName: user.name,
      assigneeImage: user.image,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.parentTaskId),
        isNull(project.archivedAt),
        ...filters,
      ),
    )
    .orderBy(...workspaceOrder(opts.sort))
    .limit(limit + 1);

  return { tasks: rows.slice(0, limit), truncated: rows.length > limit };
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
        isNull(project.archivedAt),
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
  /** Description excerpt with matched words between MARK_START and MARK_END, only when the title did not match. */
  snippet: string | null;
};

/**
 * Full-text search across the workspace for the command palette: word prefixes
 * in the title or description, plus a plain title substring so odd tokens
 * ("50%", "v2.1") still match. Title substring hits first, then best rank,
 * then open work, then recently updated. The workspace filter sits in the same WHERE, so ranking never reads
 * another workspace's rows.
 */
export async function searchTasks(
  ctx: WorkspaceContext,
  term: string,
  limit = 10,
): Promise<TaskSearchHit[]> {
  const pattern = likePattern(term);
  const prefix = toPrefixQuery(term);
  const q = prefix ? sql`to_tsquery('english', ${prefix})` : null;

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      projectName: project.name,
      projectColor: project.color,
      completedAt: task.completedAt,
      snippet: q
        ? sql<string | null>`case
            when not (to_tsvector('english', ${task.title}) @@ ${q})
             and to_tsvector('english', ${task.description}) @@ ${q}
            then ts_headline('english', translate(${task.description}, ${MARK_START + MARK_END}, ''), ${q},
              ${`StartSel=${MARK_START},StopSel=${MARK_END},MaxWords=18,MinWords=6,MaxFragments=1`})
          end`
        : sql<null>`null`,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(project.archivedAt),
        q ? or(sql`${task.search} @@ ${q}`, ilike(task.title, pattern)) : ilike(task.title, pattern),
      ),
    )
    .orderBy(
      // A literal title substring first: "50%" puts "Grow 50% faster" above
      // the "500" its prefix term also finds.
      desc(ilike(task.title, pattern)),
      ...(q ? [desc(sql`ts_rank(${task.search}, ${q})`)] : []),
      sql`${task.completedAt} is not null`,
      desc(task.updatedAt),
    )
    .limit(limit);

  return rows.map(({ completedAt, snippet, ...r }) => ({
    ...r,
    completed: completedAt !== null,
    snippet: snippet && plainSnippet(snippet),
  }));
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
