import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, notification } from '@/db';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

export async function markRead(ctx: WorkspaceContext, id: string): Promise<Result<null>> {
  return withAction(async () => {
    const rows = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.id, id),
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: notification.id });
    return rows.length ? ok(null) : err('Notification not found.');
  });
}

export async function markAllRead(ctx: WorkspaceContext): Promise<Result<null>> {
  return withAction(async () => {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
          isNull(notification.readAt),
        ),
      );
    return ok(null);
  });
}

/** Read rows outlive this, then the cron deletes them. */
export const READ_RETENTION_DAYS = 30;
/**
 * Cleared rows are kept this long: past the reminder selection and email retry
 * windows (src/server/reminders), so deleting one cannot let the cron insert
 * and email the same reminder again.
 */
export const CLEARED_RETENTION_DAYS = 3;

/** Clearing reads too: an unread hidden change item would absorb later changes out of sight. */
const clearSet = { clearedAt: sql`now()`, readAt: sql`coalesce(${notification.readAt}, now())` };

export async function clearOne(ctx: WorkspaceContext, id: string): Promise<Result<null>> {
  return withAction(async () => {
    const rows = await db
      .update(notification)
      .set(clearSet)
      .where(
        and(
          eq(notification.id, id),
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
          isNull(notification.clearedAt),
        ),
      )
      .returning({ id: notification.id });
    return rows.length ? ok(null) : err('Notification not found.');
  });
}

export async function clearAll(ctx: WorkspaceContext): Promise<Result<null>> {
  return withAction(async () => {
    await db
      .update(notification)
      .set(clearSet)
      .where(
        and(
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
          isNull(notification.clearedAt),
        ),
      );
    return ok(null);
  });
}

/** Daily housekeeping: deletes old read rows and cleared rows past their hold. Unread rows stay. */
export async function pruneNotifications(now: Date = new Date()): Promise<number> {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .delete(notification)
    .where(
      or(
        and(isNotNull(notification.readAt), lt(notification.createdAt, before(READ_RETENTION_DAYS))),
        and(isNotNull(notification.clearedAt), lt(notification.createdAt, before(CLEARED_RETENTION_DAYS))),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}
