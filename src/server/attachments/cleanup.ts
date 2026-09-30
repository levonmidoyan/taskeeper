import { and, eq, sql } from 'drizzle-orm';
import { attachment, db, task } from '@/db';
import { deleteObjects, listKeys, storageEnabled } from '@/lib/storage';

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Object keys of every attachment on these tasks and on all their subtasks,
 * however deep: subtasks cascade with their parent, and so do their files.
 * Read inside the delete's transaction, then purged once it commits.
 */
export async function attachmentKeysForTasks(tx: Tx, workspaceId: string, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const ids = sql.join(taskIds.map((id) => sql`${id}`), sql`, `);
  const rows = await tx.execute<{ key: string }>(sql`
    WITH RECURSIVE doomed(id) AS (
      SELECT id FROM task WHERE id IN (${ids}) AND workspace_id = ${workspaceId}
      UNION
      SELECT t.id FROM task t JOIN doomed d ON t.parent_task_id = d.id
    )
    SELECT a.key FROM attachment a WHERE a.task_id IN (SELECT id FROM doomed)
  `);
  return rows.rows.map((r) => r.key);
}

export async function attachmentKeysForProject(tx: Tx, workspaceId: string, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: attachment.key })
    .from(attachment)
    .innerJoin(task, eq(task.id, attachment.taskId))
    .where(and(eq(task.projectId, projectId), eq(task.workspaceId, workspaceId)));
  return rows.map((r) => r.key);
}

/**
 * Best-effort, after the rows are gone: a failure leaves orphans for the
 * sweep, never fails the delete the user asked for.
 */
export async function purgeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0 || !storageEnabled()) return;
  try {
    await deleteObjects(keys);
  } catch (error) {
    console.error('[attachments] could not purge objects', keys.length, error);
  }
}

/** Every object under each workspace's prefix, for workspaces that were deleted outright. */
export async function purgeWorkspaceObjects(workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0 || !storageEnabled()) return;
  for (const id of workspaceIds) {
    try {
      await deleteObjects(await listKeys(`ws/${id}/`));
    } catch (error) {
      console.error('[attachments] could not purge workspace objects', id, error);
    }
  }
}

