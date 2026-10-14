import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import webpush, { WebPushError } from 'web-push';
import { db, notification, organization, pushSubscription, userSettings } from '@/db';
import { PUSH_DEFAULTS, pushAllowed } from '@/lib/push';
import type { BellKind } from '@/lib/notifications';
import type { NotificationData } from '@/lib/reminders';
import { vapidConfig } from './config';
import { pushMessage, type PushPayload } from './message';

/** A notification row as one statement wrote it: created_at as text, so the stamp is exact to the microsecond. */
export type PushRef = { id: string; stamp: string };
export type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

const TTL = 86_400;
const IN_FLIGHT = 6;

async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, items.length) }, worker));
}

/**
 * Sends one payload to each subscription. A device its push service says is gone
 * (404/410) is forgotten; any other failure is logged and dropped: the bell still
 * has the item. Never throws.
 */
export async function sendToSubscriptions(
  subs: SubRow[], payload: PushPayload, urgency: 'high' | 'normal',
): Promise<{ sent: number; failed: number }> {
  const vapid = vapidConfig();
  if (!vapid || subs.length === 0) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  const used: string[] = [];
  let failed = 0;
  await pool(subs, async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL, urgency, vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
      );
      used.push(s.id);
    } catch (error) {
      failed += 1;
      const status = error instanceof WebPushError ? error.statusCode : null;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.error('Web push: send failed', status ?? error);
    }
  });
  try {
    if (gone.length > 0) await db.delete(pushSubscription).where(inArray(pushSubscription.id, gone));
    if (used.length > 0) await db.update(pushSubscription).set({ lastUsedAt: new Date() }).where(inArray(pushSubscription.id, used));
  } catch (error) {
    console.error('Web push: bookkeeping failed', error);
  }
  return { sent: used.length, failed };
}

/**
 * Pushes what these refs wrote, after commit. Re-reads each row by id AND stamp: a
 * rolled-back write has no row and a merge since has a newer stamp (and pushes for
 * itself), so neither sends. Rows whose kind the recipient turned off, and cleared
 * rows, are dropped. Never throws.
 */
export async function deliverPush(refs: PushRef[]): Promise<void> {
  if (refs.length === 0 || !vapidConfig()) return;
  try {
    const pairs = sql.join(refs.map((r) => sql`(${r.id}, ${r.stamp}::timestamptz)`), sql`, `);
    const rows = await db
      .select({
        id: notification.id, kind: notification.kind, taskId: notification.taskId, projectId: notification.projectId,
        data: notification.data, slug: organization.slug,
        sub: { id: pushSubscription.id, endpoint: pushSubscription.endpoint, p256dh: pushSubscription.p256dh, auth: pushSubscription.auth },
        prefs: {
          reminders: userSettings.pushReminders, mentions: userSettings.pushMentions,
          taskChanges: userSettings.pushTaskChanges, projectChanges: userSettings.pushProjectChanges,
        },
      })
      .from(notification)
      .innerJoin(organization, eq(organization.id, notification.workspaceId))
      .innerJoin(pushSubscription, eq(pushSubscription.userId, notification.userId))
      .leftJoin(userSettings, eq(userSettings.userId, notification.userId))
      .where(and(sql`(${notification.id}, ${notification.createdAt}) IN (${pairs})`, isNull(notification.clearedAt)));

    const byNotification = new Map<string, { row: (typeof rows)[number]; subs: SubRow[] }>();
    for (const row of rows) {
      // Drizzle nulls the whole object when the left join finds no settings row.
      const prefs = row.prefs ?? PUSH_DEFAULTS;
      if (!pushAllowed(row.kind as BellKind, prefs)) continue;
      const entry = byNotification.get(row.id) ?? { row, subs: [] };
      entry.subs.push(row.sub);
      byNotification.set(row.id, entry);
    }

    for (const { row, subs } of byNotification.values()) {
      const payload = pushMessage(row.slug, {
        id: row.id, kind: row.kind as BellKind, taskId: row.taskId, projectId: row.projectId, data: row.data as NotificationData,
      });
      await sendToSubscriptions(subs, payload, row.kind === 'mention' || row.kind === 'reminder' ? 'high' : 'normal');
    }
  } catch (error) {
    console.error('Web push: delivery failed', error);
  }
}
