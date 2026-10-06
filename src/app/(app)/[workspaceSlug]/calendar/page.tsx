import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';

/** Tasks assigned to me across every active project, by due date. */
export default async function MyCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const { m } = await searchParams;
  const today = todayInZone(ctx.timezone);
  const month = parseMonth(m, today);
  const weekStart = await getWeekStart(ctx);
  const days = monthWeeks(month, weekStart).flat();
  const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], mine: true });

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="px-4 pt-6 lg:px-8">
        <h1 className="text-title-h5 text-text-strong-950">My calendar</h1>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Tasks assigned to you, by due date.</p>
      </div>
      <CalendarMonth
        workspaceSlug={workspaceSlug}
        month={month}
        weekStart={weekStart}
        today={today}
        tasks={tasks}
        taskHref="page"
        showProject
      />
    </main>
  );
}
