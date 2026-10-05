import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { EmailSendError } from '@/lib/email';
import type { OutgoingMail } from '@/lib/reminders';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion } from '@/server/changes/queries';
import { createProject } from '@/server/projects/service';
import { claimUnsentEmails, runReminders } from '@/server/reminders/run';
import { setTaskReminders } from '@/server/reminders/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const NOW = new Date('2026-10-10T06:00:00Z');

async function setup(email = 'run@example.com', slug = 'ws-run') {
  const ada = await createUser(email, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'Ship', dueDate: '2026-10-10', assigneeId: ada.id });
  if (!made.ok) throw new Error();
  await setTaskReminders(ctx, { taskId: made.data.id, offsets: [0] });
  return { ctx, taskId: made.data.id };
}

function recorder(failFor: (m: OutgoingMail) => boolean = () => false) {
  const sent: OutgoingMail[] = [];
  const send = async (m: OutgoingMail) => {
    if (failFor(m)) throw new Error('resend down');
    sent.push(m);
  };
  return { sent, send };
}

describe('runReminders', () => {
  it('claims and emails a reminder and a digest, with address and slug', async () => {
    const { taskId } = await setup();
    const { sent, send } = recorder();

    const result = await runReminders({ now: NOW, send });

    expect(result).toEqual({ claimed: 2, emailed: 2, failed: 0 });
    expect(sent.map((m) => m.kind).sort()).toEqual(['digest', 'reminder']);
    const rem = sent.find((m) => m.kind === 'reminder')!;
    expect(rem).toMatchObject({ to: 'run@example.com', slug: 'ws-run', workspaceName: 'Acme', taskId });
  });

  it('running twice sends nothing the second time', async () => {
    await setup();
    const { sent, send } = recorder();

    await runReminders({ now: NOW, send });
    const second = await runReminders({ now: NOW, send });

    expect(second).toEqual({ claimed: 0, emailed: 0, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it('a failed send does not stop the rest, and is retried later', async () => {
    await setup();
    const failing = recorder((m) => m.kind === 'reminder');

    const first = await runReminders({ now: NOW, send: failing.send });
    expect(first).toEqual({ claimed: 2, emailed: 1, failed: 1 });

    // Still inside the 10-minute lock: not picked up again.
    const ok = recorder();
    expect(await runReminders({ now: NOW, send: ok.send })).toEqual({ claimed: 0, emailed: 0, failed: 0 });

    await db.execute(sql`update notification set email_claimed_at = now() - interval '11 minutes'`);
    expect(await runReminders({ now: NOW, send: ok.send })).toEqual({ claimed: 0, emailed: 1, failed: 0 });
    expect(ok.sent.map((m) => m.kind)).toEqual(['reminder']);
  });

  it('gives up after 3 attempts', async () => {
    await setup();
    const failing = recorder(() => true);

    for (let i = 0; i < 3; i++) {
      await runReminders({ now: NOW, send: failing.send });
      await db.execute(sql`update notification set email_claimed_at = now() - interval '11 minutes'`);
    }
    const ok = recorder();
    await runReminders({ now: NOW, send: ok.send });

    expect(ok.sent).toEqual([]);
    const rows = await db.select({ attempts: notification.emailAttempts }).from(notification);
    expect(rows.map((r) => r.attempts)).toEqual([3, 3]);
  });

  it('gets all 3 attempts on the daily schedule, a day apart', async () => {
    await setup();
    const failing = recorder(() => true);

    // Runs at hours 0, 24 and 49 (Vercel may start a daily job late in its hour).
    for (const hours of [24, 25]) {
      await runReminders({ now: NOW, send: failing.send });
      await db.execute(sql`update notification set created_at = created_at - make_interval(hours => ${hours}),
        email_claimed_at = now() - interval '11 minutes'`);
    }
    const ok = recorder();
    await runReminders({ now: NOW, send: ok.send });

    expect(ok.sent).toHaveLength(2);
  });

  it('waits out Resend’s rate limit instead of failing the row', async () => {
    await setup();
    let calls = 0;
    const sent: OutgoingMail[] = [];
    const send = async (m: OutgoingMail) => {
      calls += 1;
      // What send() throws for Resend's 429.
      if (calls === 1) throw new EmailSendError('Resend rejected the reminder email', 'rate_limit_exceeded');
      sent.push(m);
    };

    const result = await runReminders({ now: NOW, send, gapMs: 10 });

    expect(result).toEqual({ claimed: 2, emailed: 2, failed: 0 });
    const rows = await db.select({ attempts: notification.emailAttempts }).from(notification);
    expect(rows.map((r) => r.attempts)).toEqual([1, 1]);
  });

  it('does not mistake another failure for a rate limit because of its text', async () => {
    await setup();
    let calls = 0;
    // The address is user-controlled and ends up in the message.
    const send = async () => {
      calls += 1;
      throw new EmailSendError('Resend rejected the email to rate_limit_exceeded@example.com', 'validation_error');
    };

    const result = await runReminders({ now: NOW, send, gapMs: 10 });

    expect(result).toEqual({ claimed: 2, emailed: 0, failed: 2 });
    expect(calls).toBe(2);
  });

  it('stops sending at its time budget and leaves the rest unspent for the next run', async () => {
    await setup();
    const slow = async () => { await new Promise((r) => setTimeout(r, 60)); };

    const first = await runReminders({ now: NOW, send: slow, gapMs: 0, budgetMs: 20 });
    expect(first).toEqual({ claimed: 2, emailed: 1, failed: 0 });
    const left = await db.select({ attempts: notification.emailAttempts, claimed: notification.emailClaimedAt })
      .from(notification).where(sql`email_sent_at is null`);
    expect(left).toEqual([{ attempts: 0, claimed: null }]);

    // No 10-minute lock to wait out: the next run sends it.
    expect(await runReminders({ now: NOW, send: slow, gapMs: 0 })).toEqual({ claimed: 0, emailed: 1, failed: 0 });
  });

  it('spaces sends to stay under Resend’s rate limit', async () => {
    await setup();
    const times: number[] = [];

    await runReminders({ now: NOW, send: async () => { times.push(Date.now()); }, gapMs: 150 });

    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(140);
  });

  it('two overlapping claims never take the same row', async () => {
    await setup();
    await runReminders({ now: NOW, send: async () => { throw new Error('x'); } });
    await db.execute(sql`update notification set email_claimed_at = null`);

    const [a, b] = await Promise.all([claimUnsentEmails(), claimUnsentEmails()]);

    const ids = [...a, ...b].map((m) => m.notificationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
  });

  it('bumps the workspace counter when it claims something, not on an empty rerun', async () => {
    const { ctx } = await setup();
    const { send } = recorder();

    const before = await getWorkspaceVersion(ctx);
    await runReminders({ now: NOW, send, gapMs: 0 });
    const afterFirst = await getWorkspaceVersion(ctx);
    expect(afterFirst).toBe(before + 1);

    await runReminders({ now: NOW, send, gapMs: 0 });
    expect(await getWorkspaceVersion(ctx)).toBe(afterFirst);
  });

  it('leaves a workspace whose drafts were all repeats alone', async () => {
    const { ctx: first } = await setup();
    const { send } = recorder();
    await runReminders({ now: NOW, send, gapMs: 0 });
    const { ctx: second } = await setup('run-2@example.com', 'ws-run-2');

    const before = [await getWorkspaceVersion(first), await getWorkspaceVersion(second)];
    const result = await runReminders({ now: NOW, send, gapMs: 0 });
    expect(result.claimed).toBe(2);
    expect(await getWorkspaceVersion(first)).toBe(before[0]);
    expect(await getWorkspaceVersion(second)).toBe(before[1] + 1);
  });
});
