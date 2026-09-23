import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { changeMemberRole, inviteMember, removeMember } from '@/server/members/service';
import { updateWorkspaceSettings } from '@/server/settings/service';
import { listWorkspaceMembers } from '@/server/labels/queries';
import { invitation, member, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string, role: 'owner' | 'admin' | 'member' = 'owner') {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role, timezone: 'Asia/Yerevan',
  };
  return { ctx, ws, user };
}

describe('inviteMember', () => {
  it('creates a pending invitation for an owner', async () => {
    const { ctx } = await setup('owner@example.com', 'acme');

    const result = await inviteMember(ctx, { email: 'new@example.com', role: 'member' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(invitation);
    expect(row.email).toBe('new@example.com');
    expect(row.status).toBe('pending');
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a plain member', async () => {
    const { ctx } = await setup('member@example.com', 'acme2', 'member');
    const result = await inviteMember(ctx, { email: 'new@example.com', role: 'member' });

    expect(result.ok).toBe(false);
    expect(await db.select().from(invitation)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const { ctx } = await setup('owner2@example.com', 'acme3');
    expect((await inviteMember(ctx, { email: 'not-an-email', role: 'member' })).ok).toBe(false);
  });

  it('refuses to invite someone who is already a member', async () => {
    const { ctx, ws } = await setup('owner3@example.com', 'acme4');
    const bob = await createUser('bob@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    expect((await inviteMember(ctx, { email: 'bob@example.com', role: 'member' })).ok).toBe(false);
  });
});

describe('removeMember', () => {
  it('removes a member as an owner', async () => {
    const { ctx, ws } = await setup('owner4@example.com', 'acme5');
    const bob = await createUser('bob2@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const result = await removeMember(ctx, { userId: bob.id });

    expect(result.ok).toBe(true);
    expect(await listWorkspaceMembers(ctx)).toHaveLength(1);
  });

  it('refuses to remove the last owner', async () => {
    const { ctx } = await setup('owner5@example.com', 'acme6');

    // Removing the only owner would orphan the workspace: nobody could ever
    // change roles or delete it again.
    const result = await removeMember(ctx, { userId: ctx.userId });

    expect(result.ok).toBe(false);
    expect(await listWorkspaceMembers(ctx)).toHaveLength(1);
  });

  it('refuses a plain member', async () => {
    const { ctx, ws } = await setup('owner6@example.com', 'acme7');
    const bob = await createUser('bob3@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const asMember = { ...ctx, role: 'member' as const };
    expect((await removeMember(asMember, { userId: bob.id })).ok).toBe(false);
  });
});

describe('changeMemberRole', () => {
  it('promotes a member as an owner', async () => {
    const { ctx, ws } = await setup('owner7@example.com', 'acme8');
    const bob = await createUser('bob4@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const result = await changeMemberRole(ctx, { userId: bob.id, role: 'admin' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(member).where(eq(member.userId, bob.id));
    expect(row.role).toBe('admin');
  });

  it('refuses an admin, since only an owner may change roles', async () => {
    const { ctx, ws } = await setup('owner8@example.com', 'acme9');
    const bob = await createUser('bob5@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const asAdmin = { ...ctx, role: 'admin' as const };
    expect((await changeMemberRole(asAdmin, { userId: bob.id, role: 'admin' })).ok).toBe(false);
  });

  it('refuses to demote the last owner', async () => {
    const { ctx } = await setup('owner9@example.com', 'acme10');
    expect((await changeMemberRole(ctx, { userId: ctx.userId, role: 'member' })).ok).toBe(false);
  });
});

describe('updateWorkspaceSettings', () => {
  it('changes the timezone as an admin', async () => {
    const { ctx } = await setup('owner10@example.com', 'acme11');
    const asAdmin = { ...ctx, role: 'admin' as const };

    const result = await updateWorkspaceSettings(asAdmin, { timezone: 'Europe/Berlin' });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, ctx.workspaceId));
    expect(row.timezone).toBe('Europe/Berlin');
  });

  it('rejects a timezone that is not a real IANA zone', async () => {
    const { ctx } = await setup('owner11@example.com', 'acme12');
    expect((await updateWorkspaceSettings(ctx, { timezone: 'Mars/Olympus' })).ok).toBe(false);
  });

  it('refuses a plain member', async () => {
    const { ctx } = await setup('owner12@example.com', 'acme13');
    const asMember = { ...ctx, role: 'member' as const };
    expect((await updateWorkspaceSettings(asMember, { timezone: 'UTC' })).ok).toBe(false);
  });
});
