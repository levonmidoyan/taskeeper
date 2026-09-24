import { db, taskActivity } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';

export const ACTIVITY_KINDS = [
  'created', 'title', 'status', 'priority', 'assignee', 'due_date',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * `db` or a transaction handle. Callers that mutate and record together pass the
 * transaction, so a rolled-back mutation cannot leave an activity row behind.
 */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordActivity(
  ctx: WorkspaceContext,
  entry: { taskId: string; kind: ActivityKind; from?: string | null; to?: string | null },
  tx: Executor = db,
): Promise<void> {
  await tx.insert(taskActivity).values({
    id: newId(),
    workspaceId: ctx.workspaceId,
    taskId: entry.taskId,
    // From the context, never the input.
    actorId: ctx.userId,
    kind: entry.kind,
    fromValue: entry.from ?? null,
    toValue: entry.to ?? null,
  });
}
