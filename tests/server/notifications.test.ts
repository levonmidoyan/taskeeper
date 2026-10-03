import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { listNotifications, unreadCount } from '@/server/notifications/queries';
import { markAllRead, markRead } from '@/server/notifications/service';

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
