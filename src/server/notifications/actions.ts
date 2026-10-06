'use server';

import { ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { listNotifications, unreadCount, type NotificationItem } from './queries';
import { markAllRead, markRead } from './service';

/** Slug-taking wrappers only: every export here is a public endpoint. */

export async function listNotificationsAction(workspaceSlug: string): Promise<Result<NotificationItem[]>> {
  return withAction(async () => ok(await listNotifications(await requireWorkspace(workspaceSlug))));
}

export async function unreadCountAction(workspaceSlug: string): Promise<Result<number>> {
  return withAction(async () => ok(await unreadCount(await requireWorkspace(workspaceSlug))));
}

export async function markNotificationReadAction(workspaceSlug: string, id: string): Promise<Result<null>> {
  return withAction(async () => markRead(await requireWorkspace(workspaceSlug), id));
}

export async function markAllNotificationsReadAction(workspaceSlug: string): Promise<Result<null>> {
  return withAction(async () => markAllRead(await requireWorkspace(workspaceSlug)));
}
