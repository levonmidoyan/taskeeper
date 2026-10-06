import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import {
  acceptInvitation, changeMemberRole, declineInvitation, getInvitationPreview, inviteMember, removeMember,
} from '@/server/members/service';
import { updateWorkspaceSettings } from '@/server/settings/service';
import { listWorkspaceMembers } from '@/server/labels/queries';
import { invitation, member, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

const sendInviteEmail = vi.fn();
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendInviteEmail: (...a: unknown[]) => sendInviteEmail(...a),
}));

beforeEach(resetDb);
beforeEach(() => {
  sendInviteEmail.mockReset();
  sendInviteEmail.mockResolvedValue(undefined);
});
afterAll(closeDb);

async function setup(email: string, slug: string, role: 'owner' | 'admin' | 'member' = 'owner') {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role, timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
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

  // The sender sees an error and tries again; a live invite left behind would
  // pile up a duplicate on every retry.
  it('leaves no invitation behind when the email cannot be sent', async () => {
    const { ctx } = await setup('owner@example.com', 'acme');
    sendInviteEmail.mockRejectedValueOnce(new Error('SMTP invite failed: authentication rejected'));

    const result = await inviteMember(ctx, { email: 'new@example.com', role: 'member' });

    expect(result).toEqual({ ok: false, error: 'The invitation email could not be sent. Please try again.' });
    expect(await db.select().from(invitation).where(eq(invitation.email, 'new@example.com'))).toHaveLength(0);
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

describe('last-owner check under concurrency', () => {
  /** Two owners of one workspace, each with their own request context. */
  async function twoOwners(n: number) {
    const a = await setup(`race-a${n}@example.com`, `race-${n}`);
    const b = await createUser(`race-b${n}@example.com`);
    await db.insert(member).values({ id: `race-m${n}`, organizationId: a.ws.id, userId: b.id, role: 'owner' });
    const bCtx: WorkspaceContext = { ...a.ctx, userId: b.id };
    return { aCtx: a.ctx, bCtx, aId: a.user.id, bId: b.id, workspaceId: a.ws.id };
  }

  const owners = async (workspaceId: string) =>
    (await db.select().from(member).where(eq(member.organizationId, workspaceId)))
      .filter((m) => m.role === 'owner');

  // Several rounds: a race that loses only sometimes must still fail the test.
  it('keeps an owner when two owners demote each other at once', async () => {
    for (let n = 0; n < 5; n++) {
      const { aCtx, bCtx, aId, bId, workspaceId } = await twoOwners(n);

      const results = await Promise.all([
        changeMemberRole(aCtx, { userId: bId, role: 'member' }),
        changeMemberRole(bCtx, { userId: aId, role: 'member' }),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await owners(workspaceId)).toHaveLength(1);
    }
  });

  it('keeps an owner when two owners remove each other at once', async () => {
    for (let n = 0; n < 5; n++) {
      const { aCtx, bCtx, aId, bId, workspaceId } = await twoOwners(n);

      const results = await Promise.all([
        removeMember(aCtx, { userId: bId }),
        removeMember(bCtx, { userId: aId }),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await owners(workspaceId)).toHaveLength(1);
    }
  });

  it('keeps an owner when one demotes while the other removes', async () => {
    for (let n = 0; n < 5; n++) {
      const { aCtx, bCtx, aId, bId, workspaceId } = await twoOwners(n);

      await Promise.all([
        changeMemberRole(aCtx, { userId: bId, role: 'admin' }),
        removeMember(bCtx, { userId: aId }),
      ]);

      expect(await owners(workspaceId)).toHaveLength(1);
    }
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

describe('invitation answers', () => {
  async function invited(slug: string) {
    const { ctx } = await setup(`owner-${slug}@example.com`, slug);
    const guest = await createUser(`guest-${slug}@example.com`);
    const sent = await inviteMember(ctx, { email: guest.email, role: 'member' });
    if (!sent.ok) throw new Error('setup failed');
    return { ctx, guest, invitationId: sent.data.invitationId };
  }

  it('previews without joining or spending the invitation', async () => {
    const { ctx, guest, invitationId } = await invited('preview-ws');

    const preview = await getInvitationPreview(guest.email, invitationId);
    expect(preview.ok && preview.data.workspaceName).toBe('Acme');

    const members = await db.select().from(member).where(eq(member.organizationId, ctx.workspaceId));
    expect(members.map((m) => m.userId)).not.toContain(guest.id);
    const [row] = await db.select().from(invitation).where(eq(invitation.id, invitationId));
    expect(row.status).toBe('pending');
  });

  it('joins on accept', async () => {
    const { ctx, guest, invitationId } = await invited('accept-ws');

    const result = await acceptInvitation(guest.id, guest.email, invitationId);
    expect(result.ok && result.data.slug).toBe('accept-ws');
    const members = await db.select().from(member).where(eq(member.organizationId, ctx.workspaceId));
    expect(members.map((m) => m.userId)).toContain(guest.id);
  });

  it('spends the invitation on decline, without joining', async () => {
    const { ctx, guest, invitationId } = await invited('decline-ws');

    expect((await declineInvitation(guest.email, invitationId)).ok).toBe(true);
    expect((await acceptInvitation(guest.id, guest.email, invitationId)).ok).toBe(false);
    const members = await db.select().from(member).where(eq(member.organizationId, ctx.workspaceId));
    expect(members.map((m) => m.userId)).not.toContain(guest.id);
  });

  it('refuses a decline from a different address', async () => {
    const { guest, invitationId } = await invited('decline-other-ws');

    expect((await declineInvitation('someone@example.com', invitationId)).ok).toBe(false);
    expect((await getInvitationPreview(guest.email, invitationId)).ok).toBe(true);
  });
});
