import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { bellSnapshot, listNotifications, unreadCount } from '@/server/notifications/queries';
import {
  clearAll, clearOne, markAllRead, markRead, pruneNotifications,
} from '@/server/notifications/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
});

async function seed(userId: string, workspaceId: string, key: string, createdAt = new Date()) {
  const id = newId();
  await db.insert(notification).values({
    id, userId, workspaceId, kind: 'digest', dedupeKey: key, createdAt,
    data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [] },
  });
  return id;
}

async function setup() {
  const ada = await createUser('n-ada@example.com', 'Ada');
  const bob = await createUser('n-bob@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-n');
  const other = await createWorkspace(ada.id, 'Other', 'ws-n2');
  await joinWorkspace(bob.id, ws.id, 'member');
  return { ada: ctxFor(ada.id, ws), adaOther: ctxFor(ada.id, other), bob: ctxFor(bob.id, ws) };
}

describe('notifications', () => {
  it('lists only mine in this workspace, newest first, and counts unread', async () => {
    const { ada, adaOther, bob } = await setup();
    const older = await seed(ada.userId, ada.workspaceId, 'a1', new Date('2026-10-01T00:00:00Z'));
    const newer = await seed(ada.userId, ada.workspaceId, 'a2', new Date('2026-10-02T00:00:00Z'));
    await seed(ada.userId, adaOther.workspaceId, 'a3');
    await seed(bob.userId, bob.workspaceId, 'b1');

    expect((await listNotifications(ada)).map((n) => n.id)).toEqual([newer, older]);
    expect(await unreadCount(ada)).toBe(2);
  });

  it('marks one read, and cannot mark someone else’s', async () => {
    const { ada, bob } = await setup();
    const mine = await seed(ada.userId, ada.workspaceId, 'a1');
    const theirs = await seed(bob.userId, bob.workspaceId, 'b1');

    expect(await markRead(ada, mine)).toEqual({ ok: true, data: null });
    expect(await markRead(ada, theirs)).toEqual({ ok: false, error: 'Notification not found.' });

    expect(await unreadCount(ada)).toBe(0);
    expect(await unreadCount(bob)).toBe(1);
  });

  it('marks all of mine in this workspace read', async () => {
    const { ada, adaOther } = await setup();
    await seed(ada.userId, ada.workspaceId, 'a1');
    await seed(ada.userId, ada.workspaceId, 'a2');
    await seed(ada.userId, adaOther.workspaceId, 'a3');

    await markAllRead(ada);

    expect(await unreadCount(ada)).toBe(0);
    expect(await unreadCount(adaOther)).toBe(1);
  });

  it('caps the list at 30', async () => {
    const { ada } = await setup();
    for (let i = 0; i < 32; i++) await seed(ada.userId, ada.workspaceId, `k${i}`);
    expect(await listNotifications(ada)).toHaveLength(30);
  });
});

describe('change items', () => {
  it('lists change items with their project id', async () => {
    const { ada } = await setup();
    await db.insert(notification).values({
      id: newId(), userId: ada.userId, workspaceId: ada.workspaceId, kind: 'project_change', dedupeKey: `chg:${newId()}`,
      data: { projectName: 'Website', actorName: 'Bob', changes: ['deleted'] },
    });
    const [item] = await listNotifications(ada);
    expect(item).toMatchObject({ kind: 'project_change', projectId: null, taskId: null });
    expect(await unreadCount(ada)).toBe(1);
  });
});

describe('bellSnapshot', () => {
  it('returns the unread count and the database clock', async () => {
    const { ada } = await setup();
    await seed(ada.userId, ada.workspaceId, 'a1');
    const [{ now }] = (await db.execute<{ now: string }>(sql`select now()::text as now`)).rows;
    const snap = await bellSnapshot(ada);
    expect(snap.unread).toBe(1);
    expect(Math.abs(snap.now - new Date(now).getTime())).toBeLessThan(5_000);
  });
});

describe('clearing', () => {
  it('clears one of mine: hidden, read, but kept for reminder dedupe', async () => {
    const { ada, bob } = await setup();
    const mine = await seed(ada.userId, ada.workspaceId, 'a1');
    const theirs = await seed(bob.userId, bob.workspaceId, 'b1');

    expect(await clearOne(ada, mine)).toEqual({ ok: true, data: null });
    expect(await clearOne(ada, theirs)).toEqual({ ok: false, error: 'Notification not found.' });

    expect(await listNotifications(ada)).toEqual([]);
    expect(await unreadCount(ada)).toBe(0);
    expect(await listNotifications(bob)).toHaveLength(1);
    const [row] = await db.select().from(notification).where(eq(notification.id, mine));
    expect(row.clearedAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
  });

  it('clears all of mine in this workspace only', async () => {
    const { ada, adaOther, bob } = await setup();
    await seed(ada.userId, ada.workspaceId, 'a1');
    await seed(ada.userId, ada.workspaceId, 'a2');
    await seed(ada.userId, adaOther.workspaceId, 'a3');
    await seed(bob.userId, bob.workspaceId, 'b1');

    expect(await clearAll(ada)).toEqual({ ok: true, data: null });

    expect(await listNotifications(ada)).toEqual([]);
    expect(await unreadCount(ada)).toBe(0);
    expect(await listNotifications(adaOther)).toHaveLength(1);
    expect(await listNotifications(bob)).toHaveLength(1);
  });

  it('keeps the read state of an already-read item it clears', async () => {
    const { ada } = await setup();
    const id = await seed(ada.userId, ada.workspaceId, 'a1');
    await markRead(ada, id);
    const [before] = await db.select().from(notification).where(eq(notification.id, id));
    await clearAll(ada);
    const [after] = await db.select().from(notification).where(eq(notification.id, id));
    expect(after.readAt).toEqual(before.readAt);
  });
});

describe('pruneNotifications', () => {
  const ids = async () => (await db.select({ id: notification.id }).from(notification)).map((r) => r.id).sort();
  const now = new Date('2026-10-08T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('deletes read items older than 30 days and cleared items older than 3', async () => {
    const { ada } = await setup();
    const oldRead = await seed(ada.userId, ada.workspaceId, 'k1', daysAgo(31));
    const freshRead = await seed(ada.userId, ada.workspaceId, 'k2', daysAgo(29));
    const oldUnread = await seed(ada.userId, ada.workspaceId, 'k3', daysAgo(40));
    const oldCleared = await seed(ada.userId, ada.workspaceId, 'k4', daysAgo(4));
    const freshCleared = await seed(ada.userId, ada.workspaceId, 'k5', daysAgo(2));
    await markRead(ada, oldRead);
    await markRead(ada, freshRead);
    await clearOne(ada, oldCleared);
    await clearOne(ada, freshCleared);

    expect(await pruneNotifications(now)).toBe(2);
    expect(await ids()).toEqual([freshRead, oldUnread, freshCleared].sort());
  });
});
