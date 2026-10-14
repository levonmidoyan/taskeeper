import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { member, project, task, user, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import { mentionsToText } from '@/lib/mentions';
import type {
  MentionData, MentionWhere, ProjectChangeData, ProjectChangeKind, TaskChangeData, TaskChangeKind,
} from '@/lib/notifications';
import type { WorkspaceContext } from '@/lib/session';
import type { Executor } from '@/server/activity/service';
import type { PushRef } from '@/server/push/deliver';
import { schedulePush } from '@/server/push/schedule';

const COMMENT_EXCERPT = 120;

export function commentExcerpt(body: string): string {
  const flat = mentionsToText(body).replace(/\s+/g, ' ').trim();
  return flat.length > COMMENT_EXCERPT ? `${flat.slice(0, COMMENT_EXCERPT - 1)}…` : flat;
}

/**
 * Members of this workspace other than the actor who have change notifications
 * on (unless `respectToggle` is false: mentions), optionally narrowed to `candidates`. A stale assignee or creator who has
 * left the workspace drops out here. In id order: the upsert locks rows in
 * VALUES order, and two concurrent upserts locking in different orders could
 * deadlock.
 */
async function recipients(
  ctx: WorkspaceContext, tx: Executor, candidates: string[] | null, { respectToggle = true } = {},
): Promise<string[]> {
  if (candidates && candidates.length === 0) return [];
  const rows = await tx
    .select({ id: member.userId })
    .from(member)
    .leftJoin(userSettings, eq(userSettings.userId, member.userId))
    .where(and(
      eq(member.organizationId, ctx.workspaceId),
      ne(member.userId, ctx.userId),
      respectToggle ? sql`coalesce(${userSettings.changeNotify}, true)` : undefined,
      candidates ? inArray(member.userId, candidates) : undefined,
    ))
    .orderBy(member.userId);
  return rows.map((r) => r.id);
}

async function actorName(ctx: WorkspaceContext, tx: Executor): Promise<string> {
  const [row] = await tx.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId)).limit(1);
  return row?.name ?? 'Someone';
}

/**
 * The `key` arrays (default `changes`) of the stored and incoming rows: stored
 * order first, then what incoming adds. Stored kinds in `drop` go: the incoming
 * change undoes them (unarchive after archive).
 */
const mergedChanges = (drop: string[] = [], key = 'changes') => sql`(
  SELECT coalesce(jsonb_agg(c ORDER BY o), '[]'::jsonb) FROM (
    SELECT c, min(o) AS o FROM (
      SELECT x.c, x.o FROM jsonb_array_elements(n.data->${key}) WITH ORDINALITY AS x(c, o)
      ${drop.length > 0 ? sql`WHERE x.c #>> '{}' NOT IN (${sql.join(drop.map((k) => sql`${k}`), sql`, `)})` : sql``}
      UNION ALL
      SELECT y.c, y.o + 1000 FROM jsonb_array_elements(EXCLUDED.data->${key}) WITH ORDINALITY AS y(c, o)
    ) u GROUP BY c
  ) m
)`;

/** Archive and unarchive cancel out: a merged item keeps only the latest, the project's state now. */
const UNDOES: Partial<Record<ProjectChangeKind, ProjectChangeKind>> = { archived: 'unarchived', unarchived: 'archived' };

/** Keeps the stored `key` when the incoming payload lacks it. */
const keepStored = (key: string) =>
  sql`CASE WHEN (n.data ? ${key}) AND NOT (EXCLUDED.data ? ${key})
    THEN jsonb_build_object(${key}::text, n.data->${key}) ELSE '{}'::jsonb END`;

function values(rows: SQL[]): SQL {
  return sql.join(rows, sql`, `);
}

export async function notifyTaskChange(
  ctx: WorkspaceContext,
  tx: Executor,
  input: {
    taskId: string;
    changes: TaskChangeKind[];
    /** On reassignment: the assignee before the change, who hears about it too. */
    previousAssigneeId?: string | null;
    status?: string;
    comment?: string;
    /** Replaces the involved set (assignee, creator, previous assignee). The member/actor/opt-out filter still applies. */
    recipients?: string[];
    reaction?: { emoji: string; comment: string };
    /**
     * Recipients mentioned by this same write: `covers` (comment or description) is told by
     * their mention item, so it leaves their changes; with nothing left they get no item.
     */
    mentioned?: { ids: string[]; covers: TaskChangeKind };
  },
): Promise<void> {
  const changes = [...new Set(input.changes)];
  if (changes.length === 0) return;

  const [row] = await tx
    .select({ title: task.title, assigneeId: task.assigneeId, createdBy: task.createdBy, projectName: project.name })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(eq(task.id, input.taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!row) return;

  const involved = [row.assigneeId, row.createdBy, input.previousAssigneeId]
    .filter((id): id is string => Boolean(id));
  const ids = await recipients(ctx, tx, [...new Set(input.recipients ?? involved)]);
  if (ids.length === 0) return;

  const { mentioned } = input;
  const changesFor = (userId: string): TaskChangeKind[] =>
    mentioned?.ids.includes(userId) ? changes.filter((k) => k !== mentioned.covers) : changes;
  const targets = ids.filter((userId) => changesFor(userId).length > 0);
  if (targets.length === 0) return;

  const name = await actorName(ctx, tx);
  const assigned = changes.includes('assignee');
  const dataFor = (userId: string): TaskChangeData => {
    const own = changesFor(userId);
    return {
      title: row.title,
      projectName: row.projectName,
      actorName: name,
      changes: own,
      ...(assigned && userId === row.assigneeId ? { assignedToYou: true as const } : {}),
      ...(input.status && own.includes('status') ? { status: input.status } : {}),
      ...(input.comment && own.includes('comment') ? { comment: input.comment } : {}),
      ...(input.reaction && own.includes('reaction') ? { reaction: input.reaction } : {}),
    };
  };

  // assignedToYou: a later assignee change decides, so "assigned you" goes once
  // the task is someone else's. created_at is the statement's clock, not the
  // transaction's start: the bell's toast cutoff compares against it.
  const { rows } = await tx.execute<PushRef>(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, task_id, actor_id, dedupe_key, data, created_at)
    VALUES ${values(targets.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'task_change', ${input.taskId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${JSON.stringify(dataFor(userId))}::jsonb, clock_timestamp()
    )`))}
    ON CONFLICT (user_id, task_id, actor_id) WHERE kind = 'task_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('changes', ${mergedChanges()})
        || CASE WHEN n.data ? 'assignedToYou' AND NOT (EXCLUDED.data->'changes' ? 'assignee')
             THEN '{"assignedToYou": true}'::jsonb ELSE '{}'::jsonb END
        || ${keepStored('comment')}
        || ${keepStored('status')}
        || ${keepStored('reaction')},
      created_at = clock_timestamp()
    RETURNING n.id, n.created_at::text AS stamp
  `);
  schedulePush(rows);
}

/**
 * Bell items for members mentioned in a comment or description, written in the caller's
 * transaction. Returns the recipients written, in id order.
 */
export async function notifyMentions(
  ctx: WorkspaceContext,
  tx: Executor,
  input: { taskId: string; userIds: string[]; where: MentionWhere; comment?: string },
): Promise<string[]> {
  if (input.userIds.length === 0) return [];

  const [row] = await tx
    .select({ title: task.title, projectName: project.name })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(eq(task.id, input.taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!row) return [];

  // A mention is addressed to someone: the change-notification toggle does not mute it.
  const ids = await recipients(ctx, tx, [...new Set(input.userIds)], { respectToggle: false });
  if (ids.length === 0) return [];

  const data: MentionData = {
    title: row.title,
    projectName: row.projectName,
    actorName: await actorName(ctx, tx),
    where: [input.where],
    ...(input.comment ? { comment: input.comment } : {}),
  };
  const json = JSON.stringify(data);

  const { rows } = await tx.execute<PushRef>(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, task_id, actor_id, dedupe_key, data, created_at)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'mention', ${input.taskId}, ${ctx.userId},
      ${`mtn:${newId()}`}, ${json}::jsonb, clock_timestamp()
    )`))}
    ON CONFLICT (user_id, task_id, actor_id) WHERE kind = 'mention' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('where', ${mergedChanges([], 'where')})
        || ${keepStored('comment')},
      created_at = clock_timestamp()
    RETURNING n.id, n.created_at::text AS stamp
  `);
  schedulePush(rows);
  return ids;
}

export async function notifyProjectChange(
  ctx: WorkspaceContext,
  tx: Executor,
  input: {
    projectId: string;
    change: ProjectChangeKind;
    /** The name before this change: rename and delete have already altered the row. */
    projectName: string;
    newName?: string;
  },
): Promise<void> {
  const ids = await recipients(ctx, tx, null);
  if (ids.length === 0) return;

  const data: ProjectChangeData = {
    projectName: input.projectName,
    ...(input.newName ? { newName: input.newName } : {}),
    actorName: await actorName(ctx, tx),
    changes: [input.change],
  };
  const json = JSON.stringify(data);
  const undone = UNDOES[input.change];

  const { rows } = await tx.execute<PushRef>(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, project_id, actor_id, dedupe_key, data, created_at)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'project_change', ${input.projectId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${json}::jsonb, clock_timestamp()
    )`))}
    ON CONFLICT (user_id, project_id, actor_id) WHERE kind = 'project_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('projectName', n.data->'projectName', 'changes', ${mergedChanges(undone ? [undone] : [])})
        || ${keepStored('newName')},
      created_at = clock_timestamp()
    RETURNING n.id, n.created_at::text AS stamp
  `);
  schedulePush(rows);
}
