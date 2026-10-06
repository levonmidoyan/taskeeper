import { sql } from 'drizzle-orm';
import { db, notification } from '@/db';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { newId } from '@/lib/ids';
import {
  DEFAULT_REMINDER_HOUR, DIGEST_TASK_CAP, digestKey, REMINDER_CRON_HOURLY, reminderKey,
  type DigestData, type NotificationData, type ReminderOffset,
} from '@/lib/reminders';

export type NotificationDraft = {
  kind: 'reminder' | 'digest';
  userId: string;
  workspaceId: string;
  taskId: string | null;
  dedupeKey: string;
  data: NotificationData;
};

/*
 * System job queries: no ctx, they span every workspace (like sweepAttachments).
 * All zone arithmetic happens in Postgres. Zones are checked against
 * pg_timezone_names inside a MATERIALIZED CTE before any AT TIME ZONE runs, so
 * one bad stored zone skips its own rows instead of failing the whole query.
 */

/**
 * Hourly runs send at the recipient's local hour (moment in (now - 36h, now]).
 * A daily run cannot hit a local hour, so it sends on the reminder's local day
 * instead (or the day after, if a run was missed) and never once the task is
 * overdue; otherwise every zone whose hour falls after the run would get its
 * reminders a day late.
 */
export async function selectDueReminders(
  now: Date,
  { hourly = REMINDER_CRON_HOURLY }: { hourly?: boolean } = {},
): Promise<NotificationDraft[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const due = hourly
    ? sql`((due_date - offset_days) + make_time(hour, 0, 0)) AT TIME ZONE zone <= ${at}
      AND ((due_date - offset_days) + make_time(hour, 0, 0)) AT TIME ZONE zone > ${at} - interval '36 hours'`
    : sql`due_date - offset_days <= today
      AND due_date - offset_days >= today - 1
      AND due_date >= today`;
  const result = await db.execute<{
    user_id: string; workspace_id: string; task_id: string; title: string;
    project_name: string; due_date: string; offset_days: number; days_left: number;
  }>(sql`
    WITH zones AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    pending AS MATERIALIZED (
      SELECT r.user_id, t.workspace_id, t.id AS task_id, t.title, p.name AS project_name,
             t.due_date, r.offset_days::int AS offset_days,
             coalesce(us.reminder_hour, ${DEFAULT_REMINDER_HOUR})::int AS hour,
             coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) AS zone
      FROM reminder r
      JOIN task t ON t.id = r.task_id AND t.workspace_id = r.workspace_id
      JOIN task_status s ON s.id = t.status_id
      JOIN project p ON p.id = t.project_id
      JOIN member m ON m.organization_id = t.workspace_id AND m.user_id = r.user_id
      LEFT JOIN user_settings us ON us.user_id = r.user_id
      LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE t.due_date IS NOT NULL
        AND t.archived_at IS NULL
        AND NOT s.is_done
        AND p.archived_at IS NULL
        AND coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) IN (SELECT name FROM zones)
    ),
    dated AS MATERIALIZED (
      SELECT pending.*, (${at} AT TIME ZONE zone)::date AS today FROM pending
    )
    SELECT user_id, workspace_id, task_id, title, project_name, due_date::text AS due_date, offset_days,
           (due_date - today)::int AS days_left
    FROM dated
    WHERE ${due}
    ORDER BY user_id, task_id, offset_days
  `);

  return result.rows.map((r) => ({
    kind: 'reminder',
    userId: r.user_id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    dedupeKey: reminderKey(r.task_id, r.user_id, r.due_date, r.offset_days),
    data: {
      title: r.title,
      projectName: r.project_name,
      dueDate: r.due_date,
      offsetDays: r.offset_days as ReminderOffset,
      daysLeft: r.days_left,
    },
  }));
}

export async function selectDueDigests(now: Date): Promise<NotificationDraft[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute<{
    user_id: string; workspace_id: string; today: string; digest_date: string;
    task_id: string; title: string; due_date: string;
  }>(sql`
    WITH zones AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    recipients AS MATERIALIZED (
      SELECT m.user_id, m.organization_id AS workspace_id,
             coalesce(us.reminder_hour, ${DEFAULT_REMINDER_HOUR})::int AS hour,
             coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) AS zone
      FROM member m
      LEFT JOIN user_settings us ON us.user_id = m.user_id
      LEFT JOIN workspace_settings ws ON ws.workspace_id = m.organization_id
      WHERE coalesce(us.digest_enabled, true)
        AND coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) IN (SELECT name FROM zones)
    ),
    dated AS MATERIALIZED (
      SELECT r.*, (${at} AT TIME ZONE r.zone)::date AS today FROM recipients r
    ),
    due AS (
      SELECT d.*,
             CASE WHEN (d.today + make_time(d.hour, 0, 0)) AT TIME ZONE d.zone <= ${at}
                  THEN d.today ELSE d.today - 1 END AS digest_date
      FROM dated d
    )
    SELECT due.user_id, due.workspace_id, due.today::text AS today, due.digest_date::text AS digest_date,
           t.id AS task_id, t.title, t.due_date::text AS due_date
    FROM due
    JOIN task t ON t.workspace_id = due.workspace_id AND t.assignee_id = due.user_id
    JOIN task_status s ON s.id = t.status_id
    JOIN project p ON p.id = t.project_id
    WHERE t.due_date <= due.today
      AND t.archived_at IS NULL
      AND NOT s.is_done
      AND p.archived_at IS NULL
    ORDER BY due.user_id, due.workspace_id, t.due_date, t.id
  `);

  const groups = new Map<string, NotificationDraft & { data: DigestData }>();
  for (const r of result.rows) {
    const key = digestKey(r.user_id, r.workspace_id, r.digest_date);
    let draft = groups.get(key);
    if (!draft) {
      draft = {
        kind: 'digest', userId: r.user_id, workspaceId: r.workspace_id, taskId: null, dedupeKey: key,
        data: { localDate: r.digest_date, dueToday: 0, overdue: 0, tasks: [] },
      };
      groups.set(key, draft);
    }
    if (r.due_date === r.today) draft.data.dueToday += 1;
    else draft.data.overdue += 1;
    if (draft.data.tasks.length < DIGEST_TASK_CAP) {
      draft.data.tasks.push({ id: r.task_id, title: r.title, dueDate: r.due_date });
    }
  }
  return [...groups.values()];
}

async function insertDrafts(drafts: NotificationDraft[]): Promise<string[]> {
  const rows = await db
    .insert(notification)
    .values(drafts.map((d) => ({ id: newId(), ...d })))
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ workspaceId: notification.workspaceId });
  return rows.map((r) => r.workspaceId);
}

/** Postgres foreign_key_violation, as raised directly or wrapped by drizzle. */
function isForeignKeyViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23503' || e?.cause?.code === '23503';
}

/**
 * Inserts drafts whose key is new; returns the workspace of each one that was. A repeat run inserts
 * nothing. A task, user or workspace deleted since the select fails the whole
 * multi-row insert, so that case retries row by row and skips only the gone ones.
 */
export async function claimNotifications(drafts: NotificationDraft[]): Promise<string[]> {
  if (drafts.length === 0) return [];
  try {
    return await insertDrafts(drafts);
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
  }
  const inserted: string[] = [];
  for (const draft of drafts) {
    try {
      inserted.push(...(await insertDrafts([draft])));
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
    }
  }
  return inserted;
}
