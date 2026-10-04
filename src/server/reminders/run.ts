import { eq, inArray, sql } from 'drizzle-orm';
import { db, notification, organization, user } from '@/db';
import { EmailSendError, sendNotificationEmail } from '@/lib/email';
import { REMINDER_CRON_HOURLY, type MailSender, type OutgoingMail } from '@/lib/reminders';
import { emitChangeFor } from '@/server/changes/service';
import { claimNotifications, selectDueDigests, selectDueReminders } from './select';

const EMAIL_BATCH = 500;
const EMAIL_ATTEMPTS = 3;

/**
 * How long an unsent email stays worth retrying. Long enough for all
 * EMAIL_ATTEMPTS runs: hourly runs fit in 36 hours, but daily runs come 24
 * hours apart (give or take Vercel's hour of jitter), so the third is near
 * hour 48.
 */
const EMAIL_RETRY_WINDOW = REMINDER_CRON_HOURLY ? sql`interval '36 hours'` : sql`interval '60 hours'`;

/** Pause between sends. Resend's default limit is 2 requests a second per team. */
const SEND_GAP_MS = 550;
const RATE_LIMIT_RETRIES = 2;

/**
 * Sending stops here, well inside the route's 300 s maxDuration, so the job is
 * never killed mid-batch with rows claimed but unsent. What is left is released
 * for the next run.
 */
const SEND_BUDGET_MS = 240_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Resend's own error code, never the message: the message carries the address.
const rateLimited = (error: unknown) => error instanceof EmailSendError && error.code === 'rate_limit_exceeded';

/**
 * Records a delivered email. Retried on its own: failing here after the send
 * went through would otherwise mail the row again on a later run (Resend's
 * idempotency key covers that only within 24 hours).
 */
async function markSent(id: string): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      await db.update(notification).set({ emailSentAt: new Date() }).where(eq(notification.id, id));
      return;
    } catch (error) {
      if (retry === 2) throw error;
      await sleep(500 * (retry + 1));
    }
  }
}

/** Hands claimed rows back untouched: no attempt spent, no lock to wait out. */
async function releaseClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notification)
    .set({ emailClaimedAt: null, emailAttempts: sql`${notification.emailAttempts} - 1` })
    .where(inArray(notification.id, ids));
}

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
        AND email_attempts < ${EMAIL_ATTEMPTS}
        AND created_at > now() - ${EMAIL_RETRY_WINDOW}
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
  budgetMs = SEND_BUDGET_MS,
}: { now?: Date; send?: MailSender; gapMs?: number; budgetMs?: number } = {}): Promise<{ claimed: number; emailed: number; failed: number }> {
  const started = Date.now();
  const drafts = [...(await selectDueReminders(now)), ...(await selectDueDigests(now))];
  const claimed = await claimNotifications(drafts);

  // Recipients' bells live in the workspace layout, so tell those pages. A
  // workspace whose drafts were all repeats gets a harmless extra refresh.
  if (claimed > 0) {
    for (const workspaceId of new Set(drafts.map((d) => d.workspaceId))) {
      await emitChangeFor(workspaceId, db);
    }
  }

  let emailed = 0;
  let failed = 0;
  const mails = await claimUnsentEmails();
  for (const [i, mail] of mails.entries()) {
    if (i > 0) {
      if (Date.now() - started > budgetMs) {
        const rest = mails.slice(i).map((m) => m.notificationId);
        await releaseClaims(rest);
        console.warn(`[reminders] time budget spent; ${rest.length} emails left for the next run`);
        break;
      }
      await sleep(gapMs);
    }
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
    } catch (error) {
      console.error('[reminders] email failed', mail.notificationId, error);
      failed += 1;
      continue;
    }
    emailed += 1;
    try {
      await markSent(mail.notificationId);
    } catch (error) {
      console.error('[reminders] email sent but not marked sent', mail.notificationId, error);
    }
  }

  return { claimed, emailed, failed };
}
