import type { WorkspaceContext } from '@/lib/session';
import { filterFromParams, sameFilter, withDefaultState, type ParamsLike, type TaskFilter } from '@/lib/task-filter';
import { formatSortParam, parseSortParam } from '@/lib/task-table-sort';
import { defaultState, viewHref, type ViewLayout } from '@/lib/views';
import { getView, type SavedView } from './queries';

export type ResolvedView = {
  filter: TaskFilter;
  sort: string | null;
  view: SavedView | null;
  modified: boolean;
  viewMissing: boolean;
};

function read(params: ParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * What a task page should show. The URL is the whole truth: a view's link
 * carries its filter (lib/views viewHref), so this only compares URL vs stored.
 * A bare `?view=` (no `state`), or a view opened on the wrong page, redirects to
 * the view's own link.
 */
export async function resolveView(
  ctx: WorkspaceContext,
  params: ParamsLike,
  at: { layout: ViewLayout; projectId: string | null },
): Promise<ResolvedView | { redirect: string }> {
  const fallback = defaultState(at.layout);
  const filter = withDefaultState(filterFromParams(params), fallback);
  const sort = at.layout === 'list' ? formatSortParam(parseSortParam(read(params, 'sort'))) : null;

  const viewId = read(params, 'view');
  if (!viewId) return { filter, sort, view: null, modified: false, viewMissing: false };

  const view = await getView(ctx, viewId);
  if (!view) return { filter, sort, view: null, modified: false, viewMissing: true };

  const wrongPage = view.layout !== at.layout || view.projectId !== at.projectId;
  if (wrongPage || read(params, 'state') === undefined) return { redirect: viewHref(ctx.slug, view) };

  const modified = !sameFilter(filter, withDefaultState(view.filter, fallback)) || sort !== view.sort;
  return { filter, sort, view, modified, viewMissing: false };
}
