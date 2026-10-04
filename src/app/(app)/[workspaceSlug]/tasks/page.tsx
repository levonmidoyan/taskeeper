import { IconCalendar, IconList } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterEmpty } from '@/components/filters/FilterEmpty';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { ViewControls } from '@/components/views/ViewControls';
import { WorkspaceTaskTable } from '@/components/views/WorkspaceTaskTable';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { filterToParams, isFiltered } from '@/lib/task-filter';
import { parseSortParam } from '@/lib/task-table-sort';
import { defaultState, type ViewLayout } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { listWorkspaceTasks, WORKSPACE_TASK_LIMIT } from '@/server/tasks/queries';
import { resolveView } from '@/server/views/resolve';
import { cn } from '@/utils/cn';

/** Every task in the workspace's active projects, filtered; the home of workspace views. */
export default async function AllTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const sp = await searchParams;
  const layout: ViewLayout = sp.layout === 'calendar' ? 'calendar' : 'list';

  const resolved = await resolveView(ctx, sp, { layout, projectId: null });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const [members, labels] = await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx)]);
  const options = { members, labels };
  const filtered = isFiltered(resolved.filter, defaultState(layout));

  // Switching layout keeps the filter but leaves any view.
  const layoutHref = (to: ViewLayout) => {
    const p = filterToParams(resolved.filter);
    if (to === 'calendar') p.set('layout', 'calendar');
    const q = p.toString();
    return `/${workspaceSlug}/tasks${q ? `?${q}` : ''}`;
  };

  let body: React.ReactNode;
  if (layout === 'calendar') {
    const today = todayInZone(ctx.timezone);
    const month = parseMonth(typeof sp.m === 'string' ? sp.m : undefined, today);
    const weekStart = await getWeekStart(ctx);
    const days = monthWeeks(month, weekStart).flat();
    const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], workspace: true }, resolved.filter);
    body = (
      <CalendarMonth workspaceSlug={workspaceSlug} month={month} weekStart={weekStart} today={today} tasks={tasks} taskHref="page" showProject />
    );
  } else {
    const { tasks, truncated } = await listWorkspaceTasks(ctx, resolved.filter, { sort: parseSortParam(resolved.sort)[0] ?? null });
    body = tasks.length === 0 && filtered ? <FilterEmpty defaultState="open" /> : (
      <>
        {truncated && (
          <p className="px-4 py-2 text-paragraph-xs text-text-sub-600 lg:px-6">
            Showing the first {WORKSPACE_TASK_LIMIT} — narrow the filters to see the rest.
          </p>
        )}
        <WorkspaceTaskTable workspaceSlug={workspaceSlug} tasks={tasks} timezone={ctx.timezone} />
      </>
    );
  }

  return (
    <main className={cn(layout === 'calendar' && 'flex h-[calc(100dvh-3.5rem)] flex-col')}>
      <header className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 lg:px-6">
        <h1 className="min-w-0 flex-1 truncate text-label-lg text-text-strong-950">{resolved.view?.name ?? 'All tasks'}</h1>
        <div role="tablist" aria-label="Layout" className="flex items-center gap-1 rounded-10 bg-bg-weak-50 p-1">
          {(['list', 'calendar'] as const).map((l) => {
            const Icon = l === 'list' ? IconList : IconCalendar;
            const active = layout === l && !resolved.view;
            return (
              <Link key={l} href={layoutHref(l)} role="tab" aria-selected={active}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm',
                  active ? 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs' : 'text-text-sub-600 hover:text-text-strong-950')}>
                <Icon className="size-4" aria-hidden="true" />
                {l === 'list' ? 'List' : 'Calendar'}
              </Link>
            );
          })}
        </div>
      </header>
      <FilterScope filter={resolved.filter}>
        <FilterBar defaultState={defaultState(layout)} options={options}>
          <ViewControls
            workspaceSlug={workspaceSlug}
            projectId={null}
            layout={layout}
            view={resolved.view}
            modified={resolved.modified}
            filter={resolved.filter}
            sort={resolved.sort}
          />
        </FilterBar>
        {resolved.viewMissing && <ViewNotFound />}
        <FilterResults className={cn(layout === 'calendar' && 'flex min-h-0 flex-1 flex-col')}>{body}</FilterResults>
      </FilterScope>
    </main>
  );
}
