// src/server/tasks/filter.ts
import { and, eq, exists, gte, ilike, inArray, isNotNull, isNull, lt, lte, not, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db, task, taskLabel, taskStatus } from '@/db';
import { addDays, todayInZone } from '@/lib/dates';
import type { WorkspaceContext } from '@/lib/session';
import type { TaskFilter } from '@/lib/task-filter';
import { getWeekStart } from '@/server/settings/queries';
import { likePattern, toPrefixQuery } from './search-query';

export type FilterScope = 'project' | 'workspace';

/** 'me' → the caller; 'none' → unassigned. "not" keeps NULLs unless 'none' is listed. */
function personPredicate(ctx: WorkspaceContext, col: PgColumn, op: 'is' | 'not', ids: string[]): SQL | undefined {
  const concrete = ids.filter((id) => id !== 'none').map((id) => (id === 'me' ? ctx.userId : id));
  const none = ids.includes('none');
  if (op === 'is') {
    return or(concrete.length ? inArray(col, concrete) : undefined, none ? isNull(col) : undefined);
  }
  if (none) return and(isNotNull(col), concrete.length ? notInArray(col, concrete) : undefined);
  return or(isNull(col), notInArray(col, concrete));
}

function weekStartOf(today: string, weekStart: number): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((dow - weekStart + 7) % 7));
}

/**
 * The filter as SQL predicates to AND with a query's fixed ones (workspace,
 * not archived, …). Pure: `today` and `weekStart` come from the caller.
 * Every value reaches Postgres as a bound parameter.
 */
export function compileTaskFilter(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  env: { scope: FilterScope; today: string; weekStart: number },
): SQL[] {
  const out: (SQL | undefined)[] = [];

  if (filter.state && filter.state !== 'all') {
    const done = exists(
      db.select({ one: sql`1` }).from(taskStatus)
        .where(and(eq(taskStatus.id, task.statusId), eq(taskStatus.isDone, true))),
    );
    out.push(filter.state === 'done' ? done : not(done));
  }

  // Statuses belong to one project; across projects the field means nothing.
  if (filter.status && env.scope === 'project') {
    out.push(filter.status.op === 'is' ? inArray(task.statusId, filter.status.ids) : notInArray(task.statusId, filter.status.ids));
  }

  if (filter.priority) {
    out.push(filter.priority.op === 'is'
      ? inArray(task.priority, filter.priority.values)
      : notInArray(task.priority, filter.priority.values));
  }

  if (filter.assignee) out.push(personPredicate(ctx, task.assigneeId, filter.assignee.op, filter.assignee.ids));
  if (filter.createdBy) out.push(personPredicate(ctx, task.createdBy, filter.createdBy.op, filter.createdBy.ids));

  if (filter.labels) {
    const has = exists(
      db.select({ one: sql`1` }).from(taskLabel)
        .where(and(eq(taskLabel.taskId, task.id), inArray(taskLabel.labelId, filter.labels.ids))),
    );
    out.push(filter.labels.op === 'any' ? has : not(has));
  }

  if (filter.due) {
    const { today } = env;
    if ('preset' in filter.due) {
      switch (filter.due.preset) {
        case 'overdue': out.push(lt(task.dueDate, today)); break;
        case 'today': out.push(eq(task.dueDate, today)); break;
        case 'next_7d': out.push(gte(task.dueDate, today), lte(task.dueDate, addDays(today, 6))); break;
        case 'this_week': {
          const start = weekStartOf(today, env.weekStart);
          out.push(gte(task.dueDate, start), lte(task.dueDate, addDays(start, 6)));
          break;
        }
        case 'none': out.push(isNull(task.dueDate)); break;
      }
    } else {
      if (filter.due.from) out.push(gte(task.dueDate, filter.due.from));
      if (filter.due.to) out.push(lte(task.dueDate, filter.due.to));
    }
  }

  if (filter.q) {
    // The ⌘K palette's matching: word prefixes in title or description, or a title substring.
    const prefix = toPrefixQuery(filter.q);
    const title = ilike(task.title, likePattern(filter.q));
    out.push(prefix ? or(sql`${task.search} @@ to_tsquery('english', ${prefix})`, title) : title);
  }

  return out.filter((p): p is SQL => p !== undefined);
}

/** compileTaskFilter with today in the caller's zone; reads the week start only when needed. */
export async function taskFilterSql(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  scope: FilterScope,
  now: Date = new Date(),
): Promise<SQL[]> {
  const needsWeek = !!filter.due && 'preset' in filter.due && filter.due.preset === 'this_week';
  const weekStart = needsWeek ? await getWeekStart(ctx) : 1;
  return compileTaskFilter(ctx, filter, { scope, today: todayInZone(ctx.timezone, now), weekStart });
}
