import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db, project, savedView } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { parseTaskFilter } from '@/lib/task-filter';
import type { ViewLayout, ViewRef } from '@/lib/views';

export type SavedView = ViewRef & {
  name: string;
  shared: boolean;
  ownerId: string;
  mine: boolean;
  /** Owner, or a workspace owner/admin for a shared view. Mirrors service.ts. */
  canEdit: boolean;
  /** The stored filter no longer parsed and reads as {}; saving repairs it. */
  filterReset: boolean;
  createdAt: Date;
};

type Row = typeof savedView.$inferSelect;

export function canEditView(ctx: WorkspaceContext, row: Pick<Row, 'ownerId' | 'shared'>): boolean {
  return row.ownerId === ctx.userId || (row.shared && (ctx.role === 'owner' || ctx.role === 'admin'));
}

export function toSavedView(ctx: WorkspaceContext, row: Row): SavedView {
  const filter = parseTaskFilter(row.filter);
  return {
    id: row.id,
    projectId: row.projectId,
    layout: row.layout as ViewLayout,
    filter: filter ?? {},
    filterReset: filter === null,
    sort: row.sort,
    name: row.name,
    shared: row.shared,
    ownerId: row.ownerId,
    mine: row.ownerId === ctx.userId,
    canEdit: canEditView(ctx, row),
    createdAt: row.createdAt,
  };
}

/** Readable = same workspace, and mine or shared; a view of an archived project is hidden with it. */
function readable(ctx: WorkspaceContext) {
  return and(
    eq(savedView.workspaceId, ctx.workspaceId),
    or(eq(savedView.ownerId, ctx.userId), eq(savedView.shared, true)),
    or(isNull(savedView.projectId), isNull(project.archivedAt)),
  );
}

export async function listViews(
  ctx: WorkspaceContext,
  scope: { projectId: string } | { workspace: true },
): Promise<SavedView[]> {
  const rows = await db
    .select({ view: savedView })
    .from(savedView)
    .leftJoin(project, eq(project.id, savedView.projectId))
    .where(and(
      readable(ctx),
      'projectId' in scope ? eq(savedView.projectId, scope.projectId) : isNull(savedView.projectId),
    ))
    .orderBy(asc(savedView.createdAt), asc(savedView.name), asc(savedView.id));
  return rows.map((r) => toSavedView(ctx, r.view));
}

/** Missing and forbidden look the same: null. */
export async function getView(ctx: WorkspaceContext, id: string): Promise<SavedView | null> {
  const [row] = await db
    .select({ view: savedView })
    .from(savedView)
    .leftJoin(project, eq(project.id, savedView.projectId))
    .where(and(eq(savedView.id, id), readable(ctx)))
    .limit(1);
  return row ? toSavedView(ctx, row.view) : null;
}
