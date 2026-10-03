import { notFound } from 'next/navigation';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string; m?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const { task: openTaskId, m } = await searchParams;
  const today = todayInZone(ctx.timezone);
  const month = parseMonth(m, today);
  const weekStart = await getWeekStart(ctx);
  const days = monthWeeks(month, weekStart).flat();
  const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], projectId });
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
      <CalendarMonth
        workspaceSlug={workspaceSlug}
        month={month}
        weekStart={weekStart}
        today={today}
        tasks={tasks}
        taskHref="modal"
        showProject={false}
      />
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
