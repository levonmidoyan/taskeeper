import { and, eq, inArray, lt } from 'drizzle-orm';
import { attachment, db } from '@/db';
import { deleteObjects, listKeys } from '@/lib/storage';

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Objects outlive rows when an upload is never confirmed, a best-effort
 * delete fails, or a task/project/workspace delete cascades the rows away.
 * Stale pending rows go first, so their objects then count as row-less.
 */
export async function sweepAttachments(
  opts: { dryRun: boolean; now?: Date },
): Promise<{ staleRows: number; orphanObjects: number }> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - STALE_MS);
  const stale = await db
    .select({ id: attachment.id, key: attachment.key })
    .from(attachment)
    .where(and(eq(attachment.status, 'pending'), lt(attachment.createdAt, cutoff)));
  const staleKeys = new Set(stale.map((r) => r.key));

  const keys = await listKeys('ws/');
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const rows = await db.select({ key: attachment.key }).from(attachment).where(inArray(attachment.key, batch));
    for (const r of rows) if (!staleKeys.has(r.key)) known.add(r.key);
  }
  const orphans = keys.filter((k) => !known.has(k));

  if (!opts.dryRun) {
    if (stale.length) await db.delete(attachment).where(inArray(attachment.id, stale.map((r) => r.id)));
    if (orphans.length) await deleteObjects(orphans);
  }
  return { staleRows: stale.length, orphanObjects: orphans.length };
}
