import { and, eq, isNull } from 'drizzle-orm';
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
