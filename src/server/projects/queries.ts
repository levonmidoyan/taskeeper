import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, project, projectStar, task, taskStatus } from '@/db';
import { byId, byKey } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  color: string;
  openTaskCount: number;
  /** Starred by the caller; each member keeps their own stars. */
  starred: boolean;
};

export type StatusRow = {
  id: string;
  name: string;
  color: string;
  position: string;
  isDone: boolean;
  icon: string | null;
};

export type ProjectDetail = {
  id: string;
  name: string;
  slug: string;
  color: string;
  starred: boolean;
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
      // bool_or, since the star join is one row at most but sits beside the
      // task join that the count groups over.
      starred: sql<boolean>`coalesce(bool_or(${projectStar.userId} is not null), false)`,
    })
    .from(project)
    .leftJoin(
      projectStar,
      and(eq(projectStar.projectId, project.id), eq(projectStar.userId, ctx.userId)),
    )
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

export type ArchivedProject = {
  id: string;
  name: string;
  color: string;
  archivedAt: Date;
};

/** Archived projects, most recently archived first. Their only way back is unarchiveProject. */
export async function listArchivedProjects(ctx: WorkspaceContext): Promise<ArchivedProject[]> {
  const rows = await db
    .select({ id: project.id, name: project.name, color: project.color, archivedAt: project.archivedAt })
    .from(project)
    .where(and(eq(project.workspaceId, ctx.workspaceId), isNotNull(project.archivedAt)))
    .orderBy(desc(project.archivedAt), asc(project.name));

  // isNotNull above guarantees it; drizzle still types the column as nullable.
  return rows.map((row) => ({ ...row, archivedAt: row.archivedAt! }));
}

export async function getProject(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ProjectDetail | null> {
  const [row] = await db
    .select({
      id: project.id, name: project.name, slug: project.slug, color: project.color,
      starred: sql<boolean>`${projectStar.userId} is not null`,
    })
    .from(project)
    .leftJoin(
      projectStar,
      and(eq(projectStar.projectId, project.id), eq(projectStar.userId, ctx.userId)),
    )
    // Both conditions, always: the id alone would read across tenants. Archived
    // projects are gone from the sidebar and only come back from workspace
    // settings, so a bookmark to one 404s rather than opening an editable board.
    .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt)))
    .limit(1);

  if (!row) return null;

  const statuses = await db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone, icon: taskStatus.icon,
    })
    .from(taskStatus)
    .where(eq(taskStatus.projectId, projectId))
    .orderBy(byKey(taskStatus.position), byId(taskStatus.id));

  return { ...row, statuses };
}
