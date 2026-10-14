import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebPushError extends Error {
  constructor(public statusCode: number) { super(`status ${statusCode}`); }
}
const sendNotification = vi.fn(async (..._args: unknown[]) => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { sendNotification }, WebPushError: FakeWebPushError }));

const afterCallbacks: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => { afterCallbacks.push(callback); }),
}));

const { sql, eq } = await import('drizzle-orm');
const { closeDb, db, resetDb } = await import('../setup/db');
const { createUser, createWorkspace, joinWorkspace } = await import('../setup/factories');
const { notification, pushSubscription, userSettings } = await import('@/db');
const { newId } = await import('@/lib/ids');
const { deliverPush } = await import('@/server/push/deliver');
const { mentionMarkdown } = await import('@/lib/mentions');
const { createProject } = await import('@/server/projects/service');
const { createTask, updateTask } = await import('@/server/tasks/service');
const { createComment } = await import('@/server/comments/service');
const runAfter = () => Promise.all(afterCallbacks.splice(0).map((cb) => cb()));

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:t@example.com' };

beforeEach(async () => {
  await resetDb();
  afterCallbacks.length = 0;
  Object.assign(process.env, VAPID);
});
afterEach(() => {
  for (const k of Object.keys(VAPID)) delete process.env[k];
  vi.clearAllMocks();
});
afterAll(closeDb);

async function setup() {
  const ada = await createUser('pd-ada@example.com', 'Ada');
  const bob = await createUser('pd-bob@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'acme');
  await joinWorkspace(bob.id, ws.id, 'member');
  await db.insert(pushSubscription).values({ id: newId(), userId: ada.id, endpoint: 'https://push.test/ada', p256dh: 'p', auth: 'a' });
  return { ada, bob, ws };
}

/** Inserts a mention for Ada and returns its ref, as the insert sites do. */
async function mention(userId: string, workspaceId: string) {
  const id = newId();
  const { rows } = await db.execute<{ id: string; stamp: string }>(sql`
    INSERT INTO notification (id, user_id, workspace_id, kind, dedupe_key, data, created_at)
    VALUES (${id}, ${userId}, ${workspaceId}, 'mention', ${`mtn:${id}`},
      ${JSON.stringify({ title: 'Fix', projectName: 'Web', actorName: 'Bob', where: ['description'] })}::jsonb, clock_timestamp())
    RETURNING id, created_at::text AS stamp
  `);
  return rows[0];
}

describe('deliverPush', () => {
  it('sends a committed row to each of the recipient’s devices', async () => {
    const { ada, ws } = await setup();
    const ref = await mention(ada.id, ws.id);
    await deliverPush([ref]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payload, options] = sendNotification.mock.calls[0] as [{ endpoint: string }, string, { urgency: string; TTL: number }];
    expect(sub.endpoint).toBe('https://push.test/ada');
    expect(JSON.parse(payload)).toMatchObject({ title: 'Bob mentioned you', tag: ref.id, url: '/acme' });
    expect(options).toMatchObject({ urgency: 'high', TTL: 86400 });
    const [row] = await db.select().from(pushSubscription);
    expect(row.lastUsedAt).not.toBeNull();
  });

  it('skips a ref whose row never committed (rolled back)', async () => {
    await setup();
    await deliverPush([{ id: 'gone', stamp: '2026-10-13 10:00:00.123456+00' }]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips a stale stamp: a later merge pushes for itself', async () => {
    const { ada, ws } = await setup();
    const ref = await mention(ada.id, ws.id);
    await db.execute(sql`UPDATE notification SET created_at = clock_timestamp() WHERE id = ${ref.id}`);
    await deliverPush([ref]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('respects the kind toggle and never pushes cleared rows', async () => {
    const { ada, ws } = await setup();
    await db.insert(userSettings).values({ userId: ada.id, pushMentions: false });
    await deliverPush([await mention(ada.id, ws.id)]);
    expect(sendNotification).not.toHaveBeenCalled();

    await db.update(userSettings).set({ pushMentions: true });
    const ref = await mention(ada.id, ws.id);
    await db.update(notification).set({ clearedAt: new Date() }).where(eq(notification.id, ref.id));
    await deliverPush([ref]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('deletes a subscription the push service says is gone, and never throws', async () => {
    const { ada, ws } = await setup();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(410));
    await expect(deliverPush([await mention(ada.id, ws.id)])).resolves.toBeUndefined();
    expect(await db.select().from(pushSubscription)).toHaveLength(0);
  });

  it('keeps the subscription on other errors', async () => {
    const { ada, ws } = await setup();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(500));
    await expect(deliverPush([await mention(ada.id, ws.id)])).resolves.toBeUndefined();
    expect(await db.select().from(pushSubscription)).toHaveLength(1);
  });

  it('does nothing without VAPID config', async () => {
    const { ada, ws } = await setup();
    for (const k of Object.keys(VAPID)) delete process.env[k];
    await deliverPush([await mention(ada.id, ws.id)]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('capture at the insert sites', () => {
  async function scene() {
    const { ada, bob, ws } = await setup();
    const ctx = (userId: string) => ({ userId, workspaceId: ws.id, slug: 'acme', role: 'owner' as const, timezone: 'UTC', workspaceTimezone: 'UTC' });
    const project = await createProject(ctx(ada.id), { name: 'Web' });
    if (!project.ok) throw new Error('setup');
    const made = await createTask(ctx(ada.id), { projectId: project.data.id, title: 'Ship' });
    if (!made.ok) throw new Error('setup');
    afterCallbacks.length = 0;
    return { ada, bob, ctx, taskId: made.data.id };
  }

  it('a teammate’s edit pushes to the task’s creator after the response', async () => {
    const { bob, ctx, taskId } = await scene();
    await updateTask(ctx(bob.id), { taskId, title: 'Ship it' });
    expect(sendNotification).not.toHaveBeenCalled();
    await runAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('two merged edits push twice with the same tag', async () => {
    const { bob, ctx, taskId } = await scene();
    await updateTask(ctx(bob.id), { taskId, title: 'Ship it' });
    await runAfter();
    await updateTask(ctx(bob.id), { taskId, priority: 'high' });
    await runAfter();
    const tags = sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string).tag);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe(tags[1]);
  });

  it('a mention in a comment pushes', async () => {
    const { ada, bob, ctx, taskId } = await scene();
    await createComment(ctx(bob.id), { taskId, body: `hey ${mentionMarkdown(ada.id, 'Ada')}` });
    await runAfter();
    expect(sendNotification.mock.calls.some((c) => JSON.parse(c[1] as string).title === 'Bob mentioned you')).toBe(true);
  });
});

it('sendTestPush reaches every device of the caller', async () => {
  const { ada } = await setup();
  const { sendTestPush } = await import('@/server/push/service');
  const result = await sendTestPush({ userId: ada.id } as never);
  expect(result).toEqual({ ok: true, data: { sent: 1, failed: 0 } });
});
