import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { member, organization, project, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion } from '@/server/changes/queries';
import { listTaskFeed } from '@/server/activity/queries';
import { assertAccountDeletable, prepareAccountDeletion } from '@/server/account/deletion';
import { createComment } from '@/server/comments/service';
import { createProject } from '@/server/projects/service';
import { changeMemberRole } from '@/server/members/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

function ctxFor(userId: string, workspaceId: string, slug: string): WorkspaceContext {
  return { userId, workspaceId, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan' };
}

/** What Better Auth does after beforeDelete succeeds. */
async function deleteUser(userId: string) {
  await prepareAccountDeletion(userId);
  await db.delete(user).where(eq(user.id, userId));
}

describe('account deletion', () => {
  it('refuses while the user is the last owner of a shared workspace', async () => {
    const owner = await createUser('d1@example.com');
    const other = await createUser('d2@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-d1');
    await joinWorkspace(other.id, ws.id, 'member');

    await expect(assertAccountDeletable(owner.id)).rejects.toThrow(/only owner of Acme/);
    await expect(prepareAccountDeletion(owner.id)).rejects.toThrow(/only owner of Acme/);
    // A plain member of the same workspace is free to go.
    await expect(assertAccountDeletable(other.id)).resolves.toBeUndefined();
  });

  it('allows it when another owner remains', async () => {
    const owner = await createUser('d3@example.com');
    const coOwner = await createUser('d4@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-d3');
    const joined = await joinWorkspace(coOwner.id, ws.id, 'admin');
    // Promote the co-owner directly; role changes have their own tests.
    await db.update(member).set({ role: 'owner' }).where(eq(member.id, joined.id));

    await expect(assertAccountDeletable(owner.id)).resolves.toBeUndefined();
  });

  it('deletes workspaces nobody else is in, with their content', async () => {
    const owner = await createUser('d5@example.com');
    const ws = await createWorkspace(owner.id, 'Solo', 'ws-d5');
    const ctx = ctxFor(owner.id, ws.id, 'ws-d5');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });

    await deleteUser(owner.id);

    expect(await db.select().from(organization).where(eq(organization.id, ws.id))).toHaveLength(0);
    expect(await db.select().from(project).where(eq(project.workspaceId, ws.id))).toHaveLength(0);
  });

  it('keeps shared content and shows the author as "Deleted user"', async () => {
    const owner = await createUser('d6@example.com', 'Owner');
    const leaver = await createUser('d7@example.com', 'Leaver');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-d6');
    await joinWorkspace(leaver.id, ws.id, 'member');

    const ownerCtx = ctxFor(owner.id, ws.id, 'ws-d6');
    const leaverCtx: WorkspaceContext = { ...ctxFor(leaver.id, ws.id, 'ws-d6'), role: 'member' };
    const created = await createProject(ownerCtx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');
    const madeTask = await createTask(leaverCtx, { projectId: created.data.id, title: 'Ship v1' });
    if (!madeTask.ok) throw new Error('setup failed');
    await createComment(leaverCtx, { taskId: madeTask.data.id, body: 'On it' });

    await deleteUser(leaver.id);

    const feed = await listTaskFeed(ownerCtx, madeTask.data.id);
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ type: 'activity', actorId: null, actorName: 'Deleted user' });
    expect(feed[1]).toMatchObject({ type: 'comment', authorId: null, authorName: 'Deleted user' });
  });

  describe('at the database', () => {
    /** Two owners and a plain member, so the workspace is never "solo". */
    async function sharedByTwoOwners(n: number) {
      const a = await createUser(`db-a${n}@example.com`);
      const b = await createUser(`db-b${n}@example.com`);
      const c = await createUser(`db-c${n}@example.com`);
      const ws = await createWorkspace(a.id, 'Acme', `ws-db${n}`);
      const joined = await joinWorkspace(b.id, ws.id, 'admin');
      await db.update(member).set({ role: 'owner' }).where(eq(member.id, joined.id));
      await joinWorkspace(c.id, ws.id, 'member');
      return { a, b, ws };
    }

    const owners = async (workspaceId: string) =>
      (await db.select().from(member).where(eq(member.organizationId, workspaceId)))
        .filter((m) => m.role === 'owner');

    it('refuses to delete the last owner once the app check has passed', async () => {
      const { a, b, ws } = await sharedByTwoOwners(0);
      // The co-owner is demoted after beforeDelete ran but before the user row goes.
      await prepareAccountDeletion(a.id);
      await db.update(member).set({ role: 'member' }).where(eq(member.userId, b.id));

      await expect(db.delete(user).where(eq(user.id, a.id))).rejects.toThrow();

      expect(await db.select().from(user).where(eq(user.id, a.id))).toHaveLength(1);
      expect(await owners(ws.id)).toHaveLength(1);
    });

    // Several rounds: a race that loses only sometimes must still fail the test.
    it('keeps an owner when the other owner is demoted during the delete', async () => {
      for (let n = 1; n <= 5; n++) {
        const { a, b, ws } = await sharedByTwoOwners(n);
        const aCtx = ctxFor(a.id, ws.id, ws.slug);

        await prepareAccountDeletion(a.id);
        await Promise.allSettled([
          changeMemberRole(aCtx, { userId: b.id, role: 'member' }),
          db.delete(user).where(eq(user.id, a.id)),
        ]);

        expect(await owners(ws.id)).toHaveLength(1);
      }
    });

    it('still lets a whole workspace go with its members', async () => {
      const { ws } = await sharedByTwoOwners(6);

      await db.delete(organization).where(eq(organization.id, ws.id));

      expect(await db.select().from(member).where(eq(member.organizationId, ws.id))).toHaveLength(0);
    });

    it('lets the last owner leave a workspace nobody else is in', async () => {
      const a = await createUser('db-solo@example.com');
      const ws = await createWorkspace(a.id, 'Solo', 'ws-db-solo');

      await db.delete(member).where(eq(member.organizationId, ws.id));

      expect(await owners(ws.id)).toHaveLength(0);
    });
  });

  it('bumps the counter of every workspace the user shares', async () => {
    const owner = await createUser('d-live-1@example.com');
    const leaver = await createUser('d-live-2@example.com');
    const ws = await createWorkspace(owner.id, 'Shared', 'ws-live');
    await joinWorkspace(leaver.id, ws.id, 'member');
    const ctx = ctxFor(owner.id, ws.id, 'ws-live');

    const before = await getWorkspaceVersion(ctx);
    await deleteUser(leaver.id);
    expect(await getWorkspaceVersion(ctx)).toBe(before + 1);
  });
});
