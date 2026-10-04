import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, savedView } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { parseTaskFilter, type TaskFilter } from '@/lib/task-filter';
import { formatSortParam, parseSortParam } from '@/lib/task-table-sort';
import { VIEW_LAYOUTS, type ViewLayout } from '@/lib/views';
import { emitChange } from '@/server/changes/service';
import { canEditView, getView } from './queries';

const nameSchema = z.string().trim().min(1, 'Give the view a name.').max(60, 'Name is too long.');

/** Only the List sorts; a malformed sort is dropped rather than refused. */
function cleanSort(layout: ViewLayout, sort: string | null | undefined): string | null {
  return layout === 'list' ? formatSortParam(parseSortParam(sort)) : null;
}

function cleanFilter(filter: unknown): TaskFilter | null {
  return parseTaskFilter(filter);
}

export async function createView(
  ctx: WorkspaceContext,
  input: { projectId?: string | null; name: string; shared?: boolean; layout: ViewLayout; filter: unknown; sort?: string | null },
): Promise<Result<{ id: string }>> {
  const parsed = z.object({
    projectId: z.string().min(1).nullable().optional(),
    name: nameSchema,
    shared: z.boolean().optional(),
    layout: z.enum(VIEW_LAYOUTS),
  }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  const { name, layout } = parsed.data;
  const projectId = parsed.data.projectId ?? null;

  const filter = cleanFilter(input.filter);
  if (!filter) return err('That filter is not valid.');
  if (layout === 'board' && !projectId) return err('A board view needs a project.');

  if (projectId) {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt)))
      .limit(1);
    if (!owned) return err('Project not found.');
  }

  const id = newId();
  const shared = parsed.data.shared ?? false;
  await db.transaction(async (tx) => {
    await tx.insert(savedView).values({
      id,
      workspaceId: ctx.workspaceId,
      projectId,
      ownerId: ctx.userId,
      name,
      shared,
      layout,
      filter,
      sort: cleanSort(layout, input.sort),
    });
    // A private view is nobody else's business.
    if (shared) await emitChange(ctx, { projectId }, tx);
  });
  return ok({ id });
}

/** The row if the caller may change it; otherwise the error to return. */
async function editable(
  ctx: WorkspaceContext,
  id: string,
): Promise<Result<{ layout: ViewLayout; shared: boolean; projectId: string | null }>> {
  const view = await getView(ctx, id);
  if (!view) return err('View not found.');
  if (!canEditView(ctx, view)) return err('Only the owner or a workspace admin can change this view.');
  return ok({ layout: view.layout, shared: view.shared, projectId: view.projectId });
}

export async function updateView(
  ctx: WorkspaceContext,
  input: { id: string; name?: string; shared?: boolean; filter?: unknown; sort?: string | null },
): Promise<Result<null>> {
  const parsed = z.object({
    id: z.string().min(1),
    name: nameSchema.optional(),
    shared: z.boolean().optional(),
  }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);

  const target = await editable(ctx, parsed.data.id);
  if (!target.ok) return target;

  const patch: Partial<typeof savedView.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.shared !== undefined) patch.shared = parsed.data.shared;
  if (input.filter !== undefined) {
    const filter = cleanFilter(input.filter);
    if (!filter) return err('That filter is not valid.');
    patch.filter = filter;
  }
  if (input.sort !== undefined) patch.sort = cleanSort(target.data.layout, input.sort);

  await db.transaction(async (tx) => {
    await tx.update(savedView).set(patch)
      .where(and(eq(savedView.id, parsed.data.id), eq(savedView.workspaceId, ctx.workspaceId)));
    // Shared before or after: others either saw it or now will.
    if (target.data.shared || patch.shared === true) {
      await emitChange(ctx, { projectId: target.data.projectId }, tx);
    }
  });
  return ok(null);
}

export async function duplicateView(
  ctx: WorkspaceContext,
  input: { id: string; name?: string },
): Promise<Result<{ id: string }>> {
  const source = await getView(ctx, input.id);
  if (!source) return err('View not found.');
  return createView(ctx, {
    projectId: source.projectId,
    name: input.name ?? `${source.name} (copy)`.slice(0, 60),
    shared: false,
    layout: source.layout,
    filter: source.filter,
    sort: source.sort,
  });
}

export async function deleteView(ctx: WorkspaceContext, input: { id: string }): Promise<Result<null>> {
  const target = await editable(ctx, input.id);
  if (!target.ok) return target;
  await db.transaction(async (tx) => {
    await tx.delete(savedView)
      .where(and(eq(savedView.id, input.id), eq(savedView.workspaceId, ctx.workspaceId)));
    if (target.data.shared) await emitChange(ctx, { projectId: target.data.projectId }, tx);
  });
  return ok(null);
}
