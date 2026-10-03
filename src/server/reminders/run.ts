import { eq, inArray, sql } from 'drizzle-orm';
import { db, notification, organization, user } from '@/db';
import { sendNotificationEmail } from '@/lib/email';
import type { MailSender, OutgoingMail } from '@/lib/reminders';
import { claimNotifications, selectDueDigests, selectDueReminders } from './select';

const EMAIL_BATCH = 500;

/**
 * Pause between sends. Resend's default limit is 2 requests a second per team;
 * 500 sends at this pace still fit the route's 300 s maxDuration.
 */
const SEND_GAP_MS = 550;
const RATE_LIMIT_RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// send() in email.tsx rethrows Resend's `{ error }`, whose name says why.
const rateLimited = (error: unknown) => error instanceof Error && error.message.includes('rate_limit_exceeded');

/**
 * Locks up to `limit` unsent notifications for this run. SKIP LOCKED plus the
 * 10-minute claim means two overlapping runs never email the same row. Times
 * here are the database clock, not the job's `now`: they measure real elapsed
 * time since the row was created or claimed.
 */
export async function claimUnsentEmails(limit = EMAIL_BATCH): Promise<OutgoingMail[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE notification
    SET email_claimed_at = now(), email_attempts = email_attempts + 1
    WHERE id IN (
      SELECT id FROM notification
      WHERE email_sent_at IS NULL
        AND email_attempts < 3
        AND created_at > now() - interval '36 hours'
        AND (email_claimed_at IS NULL OR email_claimed_at < now() - interval '10 minutes')
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const ids = claimed.rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: notification.id, kind: notification.kind, taskId: notification.taskId, data: notification.data,
      to: user.email, slug: organization.slug, workspaceName: organization.name,
    })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .innerJoin(organization, eq(organization.id, notification.workspaceId))
    .where(inArray(notification.id, ids));

  return rows.map((r) => ({
    notificationId: r.id, to: r.to, slug: r.slug, workspaceName: r.workspaceName,
    kind: r.kind, taskId: r.taskId, data: r.data,
  }) as OutgoingMail);
}

/**
 * The reminders cron: select what is due, claim it (the bell sees it at once),
 * then email whatever is unsent. Claiming and emailing are separate so a Resend
 * outage delays email without losing or duplicating it.
 */
export async function runReminders({
  now = new Date(),
  send = sendNotificationEmail,
  gapMs = SEND_GAP_MS,
}: { now?: Date; send?: MailSender; gapMs?: number } = {}): Promise<{ claimed: number; emailed: number; failed: number }> {
  const drafts = [...(await selectDueReminders(now)), ...(await selectDueDigests(now))];
  const claimed = await claimNotifications(drafts);

  let emailed = 0;
  let failed = 0;
  const mails = await claimUnsentEmails();
  for (const [i, mail] of mails.entries()) {
    if (i > 0) await sleep(gapMs);
    try {
      // A 429 is waited out here: the next run is a day away on the daily schedule.
      for (let retry = 0; ; retry++) {
        try {
          await send(mail);
          break;
        } catch (error) {
          if (!rateLimited(error) || retry === RATE_LIMIT_RETRIES) throw error;
          await sleep(gapMs * 2 ** (retry + 1));
        }
      }
      await db.update(notification).set({ emailSentAt: new Date() }).where(eq(notification.id, mail.notificationId));
      emailed += 1;
    } catch (error) {
      console.error('[reminders] email failed', mail.notificationId, error);
      failed += 1;
    }
  }

  return { claimed, emailed, failed };
}
