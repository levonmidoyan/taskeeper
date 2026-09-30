import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { db, task, taskStatus } from '@/db';
import { byKey } from '@/lib/position';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks columns for the rest of the transaction, so writes that place tasks in
 * one column run one at a time and each reads the keys the previous one left.
 * Two creates reading the same last key would otherwise append the same key,
 * and two drops into one gap would land on the same one. Locked in id order so
 * two callers taking the same pair cannot deadlock. NO KEY UPDATE does not
 * block the key-share locks that inserting a task referencing the column takes.
 * Returns how many of the columns still exist.
 */
export async function lockColumns(tx: Tx, statusIds: string[]): Promise<number> {
  const rows = await tx
    .select({ id: taskStatus.id })
    .from(taskStatus)
    .where(inArray(taskStatus.id, statusIds))
    .orderBy(taskStatus.id)
    .for('no key update');
  return rows.length;
}

/** The column's last key, or null when it is empty. Read after lockColumns. */
export async function lastTaskPosition(
  tx: Tx,
  projectId: string,
  statusId: string,
): Promise<string | null> {
  const [last] = await tx
    .select({ position: task.position })
    .from(task)
    .where(and(eq(task.projectId, projectId), eq(task.statusId, statusId)))
    .orderBy(desc(byKey(task.position)))
    .limit(1);
  return last?.position ?? null;
}

/**
 * The first key after `before` in the column (the column's first key when
 * `before` is null), ignoring the task being placed. Read after lockColumns.
 * A drop computes its key against this rather than the neighbour the client
 * saw: when another drop has landed in the same gap since, that is the task
 * right after `before`, and a key between `before` and it is still unused.
 */
export async function nextTaskPosition(
  tx: Tx,
  projectId: string,
  statusId: string,
  before: string | null,
  excludeId: string,
): Promise<string | null> {
  const [next] = await tx
    .select({ position: task.position })
    .from(task)
    .where(
      and(
        eq(task.projectId, projectId),
        eq(task.statusId, statusId),
        ne(task.id, excludeId),
        before === null ? undefined : gt(byKey(task.position), before),
      ),
    )
    .orderBy(byKey(task.position))
    .limit(1);
  return next?.position ?? null;
}
