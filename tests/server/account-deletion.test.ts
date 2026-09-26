import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { member, organization, project, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { listTaskFeed } from '@/server/activity/queries';
import { assertAccountDeletable, prepareAccountDeletion } from '@/server/account/deletion';
import { createComment } from '@/server/comments/service';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

function ctxFor(userId: string, workspaceId: string, slug: string): WorkspaceContext {
  return { userId, workspaceId, slug, role: 'owner', timezone: 'Asia/Yerevan' };
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
});
