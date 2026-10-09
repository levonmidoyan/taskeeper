import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification, userSettings } from '@/db';
import { mentionMarkdown } from '@/lib/mentions';
import type { WorkspaceContext } from '@/lib/session';
import { commentExcerpt, notifyMentions, notifyTaskChange } from '@/server/notifications/changes';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
});

/** Ada owns the workspace and created "Ship"; Bob and Cleo are members; Dan is in another workspace. */
async function setup() {
  const adaUser = await createUser('mn-ada@example.com', 'Ada');
  const bobUser = await createUser('mn-bob@example.com', 'Bob');
  const cleoUser = await createUser('mn-cleo@example.com', 'Cleo');
  const danUser = await createUser('mn-dan@example.com', 'Dan');
  const ws = await createWorkspace(adaUser.id, 'Acme', 'ws-mn');
  await joinWorkspace(bobUser.id, ws.id, 'member');
  await joinWorkspace(cleoUser.id, ws.id, 'member');
  await createWorkspace(danUser.id, 'Other', 'ws-mn-other');
  const ada = ctxFor(adaUser.id, ws);
  const bob = ctxFor(bobUser.id, ws, 'member');
  const cleo = ctxFor(cleoUser.id, ws, 'member');
  const project = await createProject(ada, { name: 'Website' });
  if (!project.ok) throw new Error('setup');
  const made = await createTask(ada, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error('setup');
  return { ws, ada, bob, cleo, danId: danUser.id, projectId: project.data.id, taskId: made.data.id };
}

const rows = () => db.select().from(notification).orderBy(notification.createdAt);

describe('notifyMentions', () => {
  it('notifies mentioned members, not the actor or outsiders', async () => {
    const { bob, cleo, danId, taskId } = await setup();
    const written = await db.transaction((tx) =>
      notifyMentions(bob, tx, { taskId, userIds: [cleo.userId, bob.userId, danId], where: 'comment', comment: 'hi @Cleo' }));
    expect(written).toEqual([cleo.userId]);
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: cleo.userId, actorId: bob.userId, kind: 'mention', taskId, readAt: null });
    expect(row.dedupeKey).toMatch(/^mtn:/);
    expect(row.data).toEqual({ title: 'Ship', projectName: 'Website', actorName: 'Bob', where: ['comment'], comment: 'hi @Cleo' });
  });

  it('notifies even with change notifications off', async () => {
    const { bob, cleo, taskId } = await setup();
    await db.insert(userSettings).values({ userId: cleo.userId, changeNotify: false });
    await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [cleo.userId], where: 'description' }));
    expect(await rows()).toHaveLength(1);
  });

  it('merges a second mention into the unread item', async () => {
    const { bob, cleo, taskId } = await setup();
    await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [cleo.userId], where: 'comment', comment: 'one' }));
    await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [cleo.userId], where: 'description' }));
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row.data).toMatchObject({ where: ['comment', 'description'], comment: 'one' });
  });

  it('starts a new item once the old one is read', async () => {
    const { bob, cleo, taskId } = await setup();
    await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [cleo.userId], where: 'comment' }));
    await db.update(notification).set({ readAt: new Date() });
    await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [cleo.userId], where: 'comment' }));
    expect(await rows()).toHaveLength(2);
  });

  it('does nothing for an empty list', async () => {
    const { bob, taskId } = await setup();
    expect(await db.transaction((tx) => notifyMentions(bob, tx, { taskId, userIds: [], where: 'comment' }))).toEqual([]);
    expect(await rows()).toHaveLength(0);
  });
});

describe('notifyTaskChange with mentioned recipients', () => {
  it('drops a recipient whose only change the mention covers', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) =>
      notifyTaskChange(bob, tx, { taskId, changes: ['comment'], mentioned: { ids: [ada.userId], covers: 'comment' } }));
    expect(await rows()).toHaveLength(0);
  });

  it('keeps other changes for a mentioned recipient', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) =>
      notifyTaskChange(bob, tx, {
        taskId, changes: ['description', 'status'], status: 'Done', mentioned: { ids: [ada.userId], covers: 'description' },
      }));
    const [row] = await rows();
    expect(row.data).toMatchObject({ changes: ['status'], status: 'Done' });
  });
});

describe('commentExcerpt', () => {
  it('shows mentions as @Name', () => {
    expect(commentExcerpt(`ping ${mentionMarkdown('u1', 'Ana')}`)).toBe('ping @Ana');
  });
});
