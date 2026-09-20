import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { db, project, task, taskStatus } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  color: string;
  openTaskCount: number;
};

export type StatusRow = {
  id: string;
  name: string;
  color: string;
  position: string;
  isDone: boolean;
};

export type ProjectDetail = {
  id: string;
  name: string;
  slug: string;
  color: string;
  statuses: StatusRow[];
};

export async function listProjects(ctx: WorkspaceContext): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      color: project.color,
      openTaskCount: count(task.id),
    })
    .from(project)
    .leftJoin(
      task,
      and(
        eq(task.projectId, project.id),
        // task.workspace_id has its own independent FK to organization, with no
        // composite FK tying it to the project's workspace_id — so this join
        // must filter it explicitly, or a task whose workspace_id disagrees with
        // its project's would count into the wrong tenant's openTaskCount.
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.completedAt),
      ),
    )
    .where(and(eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt)))
    .groupBy(project.id)
    .orderBy(asc(project.name));

  return rows;
}

export async function getProject(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ProjectDetail | null> {
  const [row] = await db
    .select({ id: project.id, name: project.name, slug: project.slug, color: project.color })
    .from(project)
    // Both conditions, always: the id alone would read across tenants.
    .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);

  if (!row) return null;

  const statuses = await db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone,
    })
    .from(taskStatus)
    .where(eq(taskStatus.projectId, projectId))
    .orderBy(asc(taskStatus.position));

  return { ...row, statuses };
}
