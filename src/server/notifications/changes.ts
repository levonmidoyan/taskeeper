import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { member, project, task, user, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import type {
  ProjectChangeData, ProjectChangeKind, TaskChangeData, TaskChangeKind,
} from '@/lib/notifications';
import type { WorkspaceContext } from '@/lib/session';
import type { Executor } from '@/server/activity/service';

const COMMENT_EXCERPT = 120;

export function commentExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > COMMENT_EXCERPT ? `${flat.slice(0, COMMENT_EXCERPT - 1)}…` : flat;
}

/**
 * Members of this workspace other than the actor who have change notifications
 * on, optionally narrowed to `candidates`. A stale assignee or creator who has
 * left the workspace drops out here.
 */
async function recipients(ctx: WorkspaceContext, tx: Executor, candidates: string[] | null): Promise<string[]> {
  if (candidates && candidates.length === 0) return [];
  const rows = await tx
    .select({ id: member.userId })
    .from(member)
    .leftJoin(userSettings, eq(userSettings.userId, member.userId))
    .where(and(
      eq(member.organizationId, ctx.workspaceId),
      ne(member.userId, ctx.userId),
      sql`coalesce(${userSettings.changeNotify}, true)`,
      candidates ? inArray(member.userId, candidates) : undefined,
    ));
  return rows.map((r) => r.id);
}

async function actorName(ctx: WorkspaceContext, tx: Executor): Promise<string> {
  const [row] = await tx.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId)).limit(1);
  return row?.name ?? 'Someone';
}

/** The `changes` arrays of the stored and incoming rows: stored order first, then what incoming adds. */
const mergedChanges = sql`(
  SELECT coalesce(jsonb_agg(c ORDER BY o), '[]'::jsonb) FROM (
    SELECT c, min(o) AS o FROM (
      SELECT x.c, x.o FROM jsonb_array_elements(n.data->'changes') WITH ORDINALITY AS x(c, o)
      UNION ALL
      SELECT y.c, y.o + 1000 FROM jsonb_array_elements(EXCLUDED.data->'changes') WITH ORDINALITY AS y(c, o)
    ) u GROUP BY c
  ) m
)`;

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
  const ids = await recipients(ctx, tx, [...new Set(involved)]);
  if (ids.length === 0) return;

  const name = await actorName(ctx, tx);
  const assigned = changes.includes('assignee');
  const dataFor = (userId: string): TaskChangeData => ({
    title: row.title,
    projectName: row.projectName,
    actorName: name,
    changes,
    ...(assigned && userId === row.assigneeId ? { assignedToYou: true as const } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
  });

  await tx.execute(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, task_id, actor_id, dedupe_key, data)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'task_change', ${input.taskId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${JSON.stringify(dataFor(userId))}::jsonb
    )`))}
    ON CONFLICT (user_id, task_id, actor_id) WHERE kind = 'task_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('changes', ${mergedChanges})
        || CASE WHEN n.data ? 'assignedToYou' THEN '{"assignedToYou": true}'::jsonb ELSE '{}'::jsonb END
        || ${keepStored('comment')}
        || ${keepStored('status')},
      created_at = now()
  `);
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

  await tx.execute(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, project_id, actor_id, dedupe_key, data)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'project_change', ${input.projectId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${json}::jsonb
    )`))}
    ON CONFLICT (user_id, project_id, actor_id) WHERE kind = 'project_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('projectName', n.data->'projectName', 'changes', ${mergedChanges})
        || ${keepStored('newName')},
      created_at = now()
  `);
}
