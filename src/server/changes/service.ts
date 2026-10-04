import { sql } from 'drizzle-orm';
import { db, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The mutation's own transaction, or db for a write that has none. */
export type Executor = typeof db | Tx;

/**
 * What changed. No projectId = anything in the workspace may have changed.
 * Polling ignores it today; a Pusher publish will send it, so clients can skip
 * changes to projects they are not looking at.
 */
export type ChangeScope = { projectId?: string | null };

/** Bumps the workspace counter for callers that have no WorkspaceContext. */
export async function emitChangeFor(workspaceId: string, tx: Executor): Promise<void> {
  await tx
    .insert(workspaceChange)
    .values({ workspaceId, version: 1 })
    .onConflictDoUpdate({
      target: workspaceChange.workspaceId,
      set: { version: sql`${workspaceChange.version} + 1`, changedAt: sql`now()` },
    });
}

/**
 * Tells open pages that shared workspace data changed. Call it inside the
 * mutation's transaction, after the write, so a rolled-back write never bumps.
 * When Pusher lands, this also queues a publish of `scope` to run after commit.
 */
export async function emitChange(ctx: WorkspaceContext, scope: ChangeScope, tx: Executor): Promise<void> {
  await emitChangeFor(ctx.workspaceId, tx);
}
