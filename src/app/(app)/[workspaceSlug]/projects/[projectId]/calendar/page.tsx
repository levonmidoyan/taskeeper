import { notFound, redirect } from 'next/navigation';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { defaultState } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { resolveView } from '@/server/views/resolve';

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const sp = await searchParams;
  const resolved = await resolveView(ctx, sp, { layout: 'calendar', projectId });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const openTaskId = typeof sp.task === 'string' ? sp.task : undefined;
  const today = todayInZone(ctx.timezone);
  const month = parseMonth(typeof sp.m === 'string' ? sp.m : undefined, today);
  const weekStart = await getWeekStart(ctx);
  const days = monthWeeks(month, weekStart).flat();
  const [tasks, members, labels] = await Promise.all([
    listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], projectId }, resolved.filter),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
  ]);
  const options = { statuses: project.statuses, members, labels };
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  // Viewport minus the h-14 app header, so the grid fills the page.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
        menu={canManage && <ProjectMenu workspaceSlug={workspaceSlug} projectId={projectId} name={project.name} />}
      />
      <FilterScope>
        <FilterBar filter={resolved.filter} defaultState={defaultState('calendar')} options={options} />
        {resolved.viewMissing && <ViewNotFound />}
        <FilterResults className="flex min-h-0 flex-1 flex-col">
          <CalendarMonth
            workspaceSlug={workspaceSlug}
            month={month}
            weekStart={weekStart}
            today={today}
            tasks={tasks}
            taskHref="modal"
            showProject={false}
          />
        </FilterResults>
      </FilterScope>
      <ProjectTaskDialog
        ctx={ctx}
        taskId={openTaskId}
        projectId={projectId}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
      />
    </main>
  );
}
