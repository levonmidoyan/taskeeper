import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { notification } from '@/db';
import type { OutgoingMail } from '@/lib/reminders';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { claimUnsentEmails, runReminders } from '@/server/reminders/run';
import { setTaskReminders } from '@/server/reminders/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const NOW = new Date('2026-10-10T06:00:00Z');

async function setup() {
  const ada = await createUser('run@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-run');
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug: 'ws-run', role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
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

  it('waits out Resend’s rate limit instead of failing the row', async () => {
    await setup();
    let calls = 0;
    const sent: OutgoingMail[] = [];
    const send = async (m: OutgoingMail) => {
      calls += 1;
      // What send() throws for Resend's 429.
      if (calls === 1) throw new Error('Resend rejected the reminder email to x: rate_limit_exceeded — Too many requests');
      sent.push(m);
    };

    const result = await runReminders({ now: NOW, send, gapMs: 10 });

    expect(result).toEqual({ claimed: 2, emailed: 2, failed: 0 });
    const rows = await db.select({ attempts: notification.emailAttempts }).from(notification);
    expect(rows.map((r) => r.attempts)).toEqual([1, 1]);
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
});
