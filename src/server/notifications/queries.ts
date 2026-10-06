import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, notification } from '@/db';
import type { NotificationData } from '@/lib/reminders';
import type { WorkspaceContext } from '@/lib/session';

export type NotificationItem = {
  id: string;
  kind: 'reminder' | 'digest';
  taskId: string | null;
  data: NotificationData;
  readAt: Date | null;
  createdAt: Date;
};

const mine = (ctx: WorkspaceContext) =>
  and(eq(notification.userId, ctx.userId), eq(notification.workspaceId, ctx.workspaceId));

export async function listNotifications(ctx: WorkspaceContext, limit = 30): Promise<NotificationItem[]> {
  return db
    .select({
      id: notification.id, kind: notification.kind, taskId: notification.taskId, data: notification.data,
      readAt: notification.readAt, createdAt: notification.createdAt,
    })
    .from(notification)
    .where(mine(ctx))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit);
}

export async function unreadCount(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(mine(ctx), isNull(notification.readAt)));
  return row?.n ?? 0;
}
