import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, task } from '@/db';
import { byKey } from '@/lib/position';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks a parent for the rest of the transaction, so writes that place its
 * subtasks run one at a time and each reads the keys the previous one left (as
 * lockColumns does for board columns). NO KEY UPDATE does not block the
 * key-share lock that inserting a child referencing it takes. False when the
 * parent is gone.
 */
export async function lockParent(tx: Tx, parentId: string): Promise<boolean> {
  const rows = await tx.select({ id: task.id }).from(task).where(eq(task.id, parentId)).for('no key update');
  return rows.length > 0;
}

/** The parent's last subtask key, or null when it has none. Read after lockParent. */
export async function lastSubtaskPosition(tx: Tx, parentId: string): Promise<string | null> {
  const [last] = await tx
    .select({ p: task.subtaskPosition })
    .from(task)
    .where(and(eq(task.parentTaskId, parentId), isNull(task.archivedAt)))
    .orderBy(desc(byKey(task.subtaskPosition)))
    .limit(1);
  return last?.p ?? null;
}
