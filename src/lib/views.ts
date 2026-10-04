import { filterToParams, withDefaultState, type TaskFilter, type TaskState } from '@/lib/task-filter';

export const VIEW_LAYOUTS = ['board', 'list', 'calendar'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

/** Project tabs show this many saved views; the rest go under "More views". */
export const MAX_VIEW_TABS = 5;

/** The Board has a done column, so it shows everything; lists hide finished work. */
export function defaultState(layout: ViewLayout): TaskState {
  return layout === 'board' ? 'all' : 'open';
}

export type ViewRef = {
  id: string;
  projectId: string | null;
  layout: ViewLayout;
  filter: TaskFilter;
  sort: string | null;
};

export function layoutPath(workspaceSlug: string, projectId: string | null, layout: ViewLayout): string {
  if (!projectId) return `/${workspaceSlug}/tasks${layout === 'calendar' ? '?layout=calendar' : ''}`;
  const base = `/${workspaceSlug}/projects/${projectId}`;
  return layout === 'board' ? base : `${base}/${layout}`;
}

/**
 * A view's link: its page plus its whole filter, so the URL alone reproduces it
 * and "modified" is just URL vs stored. `state` is always present — a bare
 * `?view=` (no state) is how the page knows to load the stored filter.
 */
export function viewHref(workspaceSlug: string, view: ViewRef): string {
  const path = layoutPath(workspaceSlug, view.projectId, view.layout);
  const [pathname, existing] = path.split('?');
  const params = new URLSearchParams(existing);
  params.set('view', view.id);
  for (const [k, v] of filterToParams(withDefaultState(view.filter, defaultState(view.layout)))) params.set(k, v);
  if (view.layout === 'list' && view.sort) params.set('sort', view.sort);
  return `${pathname}?${params.toString()}`;
}
