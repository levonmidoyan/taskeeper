import { and, asc, eq, gte, isNull, isNotNull, lte } from 'drizzle-orm';
import { db, project, task, taskStatus, user } from '@/db';
import { addDays, isCalendarDay } from '@/lib/dates';
import { byKey } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';

export type CalendarTask = {
  id: string;
  title: string;
  dueDate: string;
  isDone: boolean;
  statusColor: string;
  statusIcon: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  projectId: string;
  projectName: string;
  projectColor: string;
};

export type CalendarRange = { from: string; to: string } & ({ projectId: string } | { mine: true });

const MAX_DAYS = 42;

/**
 * Dated tasks in a visible calendar range, for one project or for "my calendar"
 * (assigned to me across active projects). Subtasks are included: they carry
 * their own due dates.
 */
export async function listCalendarTasks(ctx: WorkspaceContext, range: CalendarRange): Promise<CalendarTask[]> {
  const { from, to } = range;
  if (!isCalendarDay(from) || !isCalendarDay(to) || to < from || addDays(from, MAX_DAYS - 1) < to) {
    throw new RangeError(`Calendar range ${from}..${to} is invalid or longer than ${MAX_DAYS} days.`);
  }

  const scope = 'projectId' in range ? eq(task.projectId, range.projectId) : eq(task.assigneeId, ctx.userId);

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      isDone: taskStatus.isDone,
      statusColor: taskStatus.color,
      statusIcon: taskStatus.icon,
      assigneeName: user.name,
      assigneeImage: user.image,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        scope,
        isNotNull(task.dueDate),
        gte(task.dueDate, from),
        lte(task.dueDate, to),
        isNull(task.archivedAt),
        isNull(project.archivedAt),
      ),
    )
    .orderBy(asc(task.dueDate), byKey(task.position), asc(task.id));

  // due_date is non-null here (filtered above); the select type cannot know that.
  return rows as CalendarTask[];
}
