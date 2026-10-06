import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, label, project, task, taskLabel, taskStatus, user } from '@/db';
import { err, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { filterFromParams, withDefaultState } from '@/lib/task-filter';
import type { SortableColumn } from '@/lib/task-table-sort';
import { listTaskFeed } from '@/server/activity/queries';
import { listLabels } from '@/server/labels/queries';
import { listWorkspaceTasks, type Priority } from '@/server/tasks/queries';
import type { ApiComment, ApiMe, ApiTaskPage } from './contract/shapes';
import type { TaskListQuery } from './contract/tasks';
import { encodeCursor } from './cursor';
import { serializeComment, serializeTaskSummary } from './serialize';

export async function getApiUser(userId: string): Promise<ApiMe | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

/** What serializeTaskSummary needs, whichever query produced it. */
export type ApiTaskSource = {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  statusId: string;
  statusName: string;
  isDone: boolean;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  labels: { id: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
};

export const taskNotFound = (): Result<never> => err('Task not found.', 'not_found');

/**
 * One task of this workspace, or null when it is missing, another workspace's,
 * archived or in an archived project. Task routes call it before every write,
 * so those cases are a 404 rather than a service's 422.
 */
export async function findApiTask(
  ctx: WorkspaceContext,
  taskId: string,
): Promise<(ApiTaskSource & { description: string }) | null> {
  const [row] = await db
    .select({
      id: task.id,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      title: task.title,
      description: task.description,
      statusId: task.statusId,
      statusName: taskStatus.name,
      isDone: taskStatus.isDone,
      priority: task.priority,
      assigneeId: task.assigneeId,
      assigneeName: user.name,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
    .limit(1);
  if (!row) return null;

  const labels = await db
    .select({ id: label.id, name: label.name })
    .from(taskLabel)
    .innerJoin(label, eq(label.id, taskLabel.labelId))
    .where(eq(taskLabel.taskId, taskId))
    .orderBy(asc(label.name));

  return { ...row, priority: row.priority as Priority, labels };
}

export async function listApiTasks(ctx: WorkspaceContext, query: TaskListQuery): Promise<ApiTaskPage> {
  // The URL grammar the web app uses; the contract has already validated each value.
  const filter = withDefaultState(filterFromParams(query as unknown as Record<string, string | undefined>), 'open');
  const sort = query.sort
    ? { id: query.sort.replace(/^-/, '') as SortableColumn, desc: query.sort.startsWith('-') }
    : null;

  const [{ tasks, truncated }, labels] = await Promise.all([
    listWorkspaceTasks(ctx, filter, {
      sort, limit: query.limit, offset: query.cursor, projectId: query.projectId, includeSubtasks: true,
    }),
    listLabels(ctx),
  ]);
  const labelName = new Map(labels.map((l) => [l.id, l.name]));

  return {
    data: tasks.map((t) => serializeTaskSummary(ctx.slug, {
      ...t,
      labels: t.labelIds.filter((id) => labelName.has(id)).map((id) => ({ id, name: labelName.get(id)! })),
    })),
    nextCursor: truncated ? encodeCursor(query.cursor + query.limit) : null,
  };
}

/** Comment entries of the task feed, oldest first. The caller checks the task first. */
export async function listApiComments(ctx: WorkspaceContext, taskId: string): Promise<ApiComment[]> {
  const feed = await listTaskFeed(ctx, taskId);
  return feed.flatMap((entry) => (entry.type === 'comment' ? [serializeComment(entry)] : []));
}
