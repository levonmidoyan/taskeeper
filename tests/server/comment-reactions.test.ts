import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { commentReaction, member, notification, user, userSettings, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { createComment } from '@/server/comments/service';
import { setReaction } from '@/server/comments/reactions';
import { archiveProject, createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
});

/** Ada owns the workspace and wrote a comment on her task; Bob is a member. */
async function setup(slug = 'ws-rx') {
  const adaUser = await createUser(`${slug}-ada@example.com`, 'Ada');
  const bobUser = await createUser(`${slug}-bob@example.com`, 'Bob');
  const ws = await createWorkspace(adaUser.id, 'Acme', slug);
  await joinWorkspace(bobUser.id, ws.id, 'member');
  const ada = ctxFor(adaUser.id, ws);
  const bob = ctxFor(bobUser.id, ws, 'member');
  const project = await createProject(ada, { name: 'Website' });
  if (!project.ok) throw new Error('setup');
  const made = await createTask(ada, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error('setup');
  const posted = await createComment(ada, { taskId: made.data.id, body: 'Shipped it' });
  if (!posted.ok) throw new Error('setup');
  // createComment notified nobody (Ada is creator and actor), but clear to be safe.
  await db.delete(notification);
  return { ws, ada, bob, projectId: project.data.id, taskId: made.data.id, commentId: posted.data.id };
}

const reactions = () => db.select().from(commentReaction);
const notes = () => db.select().from(notification);

describe('setReaction', () => {
  it('adds with on and removes without', async () => {
    const { bob, commentId } = await setup();

    expect(await setReaction(bob, { commentId, emoji: '👍', on: true })).toEqual({ ok: true, data: { reacted: true } });
    expect(await reactions()).toEqual([expect.objectContaining({ commentId, userId: bob.userId, emoji: '👍', workspaceId: bob.workspaceId })]);

    expect(await setReaction(bob, { commentId, emoji: '👍', on: false })).toEqual({ ok: true, data: { reacted: false } });
    expect(await reactions()).toHaveLength(0);
  });

  it('is idempotent: a repeated request keeps the state instead of flipping it', async () => {
    const { bob, commentId } = await setup();
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    expect(await setReaction(bob, { commentId, emoji: '👍', on: true })).toEqual({ ok: true, data: { reacted: true } });
    expect(await reactions()).toHaveLength(1);
    expect(await notes()).toHaveLength(1);

    await setReaction(bob, { commentId, emoji: '👍', on: false });
    expect(await setReaction(bob, { commentId, emoji: '👍', on: false })).toEqual({ ok: true, data: { reacted: false } });
    expect(await reactions()).toHaveLength(0);
  });

  it('lets one person add several different emoji', async () => {
    const { bob, commentId } = await setup();
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    await setReaction(bob, { commentId, emoji: '🚀', on: true });
    expect((await reactions()).map((r) => r.emoji).sort()).toEqual(['👍', '🚀'].sort());
  });

  // Review Focus 4.
  it('rejects an emoji outside the set, including a bare heart', async () => {
    const { bob, commentId } = await setup();
    expect(await setReaction(bob, { commentId, emoji: '💩', on: true })).toEqual({ ok: false, error: 'Unknown reaction.' });
    expect(await setReaction(bob, { commentId, emoji: '❤', on: true })).toEqual({ ok: false, error: 'Unknown reaction.' });
    expect(await reactions()).toHaveLength(0);
  });

  it('refuses a comment in another workspace', async () => {
    const a = await setup('ws-rx-a');
    const b = await setup('ws-rx-b');
    expect(await setReaction(b.bob, { commentId: a.commentId, emoji: '👍', on: true })).toEqual({ ok: false, error: 'Comment not found.' });
    expect(await reactions()).toHaveLength(0);
  });

  // Review Focus 5.
  it('refuses a comment on an archived project', async () => {
    const { ada, bob, projectId, commentId } = await setup();
    const archived = await archiveProject(ada, { projectId });
    expect(archived.ok).toBe(true);
    expect(await setReaction(bob, { commentId, emoji: '👍', on: true })).toEqual({ ok: false, error: 'Comment not found.' });
  });

  it('bumps the workspace change stamp', async () => {
    const { bob, commentId } = await setup();
    const before = (await db.select().from(workspaceChange))[0]?.version ?? 0;
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    const [after] = await db.select().from(workspaceChange).where(eq(workspaceChange.workspaceId, bob.workspaceId));
    expect(after.version).toBeGreaterThan(before);
  });
});

describe('setReaction notifications', () => {
  it('tells the comment author once, with the emoji and an excerpt', async () => {
    const { ada, bob, commentId } = await setup();
    await setReaction(bob, { commentId, emoji: '🎉', on: true });
    const [row, ...rest] = await notes();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: ada.userId, actorId: bob.userId, kind: 'task_change' });
    expect(row.data).toMatchObject({ changes: ['reaction'], reaction: { emoji: '🎉', comment: 'Shipped it' } });
  });

  // Review Focus 3.
  it('merges repeated reactions by one person into one unread item showing the latest', async () => {
    const { bob, commentId } = await setup();
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    await setReaction(bob, { commentId, emoji: '🚀', on: true });
    const [row, ...rest] = await notes();
    expect(rest).toHaveLength(0);
    expect(row.data).toMatchObject({ changes: ['reaction'], reaction: { emoji: '🚀' } });
  });

  it('does not notify on removal', async () => {
    const { bob, commentId } = await setup();
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    await db.delete(notification);
    await setReaction(bob, { commentId, emoji: '👍', on: false });
    expect(await notes()).toHaveLength(0);
  });

  it('does not notify someone reacting to their own comment', async () => {
    const { ada, commentId } = await setup();
    await setReaction(ada, { commentId, emoji: '👍', on: true });
    expect(await notes()).toHaveLength(0);
  });

  it('respects the author turning change notifications off', async () => {
    const { ada, bob, commentId } = await setup();
    await db.insert(userSettings).values({ userId: ada.userId, changeNotify: false })
      .onConflictDoUpdate({ target: userSettings.userId, set: { changeNotify: false } });
    await setReaction(bob, { commentId, emoji: '👍', on: true });
    expect(await notes()).toHaveLength(0);
  });

  it('reacts but notifies nobody once the author has deleted their account', async () => {
    const { ada, bob, commentId } = await setup();
    // A workspace must keep an owner (member_keep_owner), so Bob takes over first.
    await db.update(member).set({ role: 'owner' }).where(eq(member.userId, bob.userId));
    await db.delete(user).where(eq(user.id, ada.userId));
    expect((await setReaction(bob, { commentId, emoji: '👍', on: true })).ok).toBe(true);
    expect(await reactions()).toHaveLength(1);
    expect(await notes()).toHaveLength(0);
  });

  // Review Focus 2.
  it('reacts but notifies nobody when the author has left the workspace', async () => {
    const { ada, bob, commentId } = await setup();
    // A workspace must keep an owner (member_keep_owner), so Bob takes over first.
    await db.update(member).set({ role: 'owner' }).where(eq(member.userId, bob.userId));
    await db.delete(member).where(eq(member.userId, ada.userId));
    expect((await setReaction(bob, { commentId, emoji: '👍', on: true })).ok).toBe(true);
    expect(await reactions()).toHaveLength(1);
    expect(await notes()).toHaveLength(0);
  });
});
