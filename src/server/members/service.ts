import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, invitation, member, organization, user } from '@/db';
import { sendInviteEmail } from '@/lib/email';
import { newId } from '@/lib/ids';
import { appUrl } from '@/lib/url';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';

const INVITE_TTL_DAYS = 7;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the workspace row for the rest of the transaction, so owner changes in
 * one workspace run one at a time: two owners demoting or removing each other
 * at once must not both pass the last-owner check.
 */
async function lockWorkspace(tx: Tx, workspaceId: string): Promise<void> {
  await tx.select({ id: organization.id }).from(organization)
    .where(eq(organization.id, workspaceId)).for('update');
}

async function ownerCount(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.role, 'owner')));
  return row?.n ?? 0;
}

export async function inviteMember(
  ctx: WorkspaceContext,
  input: { email: string; role: 'admin' | 'member' },
): Promise<Result<{ invitationId: string }>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
        role: z.enum(['admin', 'member']),
      })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const [existing] = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(user.email, parsed.data.email)))
      .limit(1);
    if (existing) return err('That person is already in this workspace.');

    const id = newId();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db.insert(invitation).values({
      id, organizationId: ctx.workspaceId, email: parsed.data.email,
      role: parsed.data.role, status: 'pending', expiresAt, inviterId: ctx.userId,
    });

    const [ws] = await db
      .select({ name: organization.name })
      .from(organization).where(eq(organization.id, ctx.workspaceId)).limit(1);
    const [inviter] = await db
      .select({ name: user.name, email: user.email })
      .from(user).where(eq(user.id, ctx.userId)).limit(1);

    await sendInviteEmail({
      to: parsed.data.email,
      url: `${appUrl()}/invite/${id}`,
      workspaceName: ws?.name ?? 'the workspace',
      role: parsed.data.role,
      inviter,
      expiresInDays: INVITE_TTL_DAYS,
    });

    return ok({ invitationId: id });
  });
}

export async function removeMember(
  ctx: WorkspaceContext,
  input: { userId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    return db.transaction(async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);

      const [target] = await tx
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)))
        .limit(1);
      if (!target) return err('That person is not in this workspace.');

      // Removing the last owner would leave nobody able to manage the workspace.
      if (target.role === 'owner' && (await ownerCount(tx, ctx.workspaceId)) <= 1) {
        return err('A workspace must keep at least one owner.');
      }
      if (target.role === 'owner') requireRole(ctx, 'owner');

      await tx
        .delete(member)
        .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)));

      return ok(null);
    });
  });
}

export async function changeMemberRole(
  ctx: WorkspaceContext,
  input: { userId: string; role: 'owner' | 'admin' | 'member' },
): Promise<Result<null>> {
  return withAction(async () => {
    // Only an owner changes roles (spec §4).
    requireRole(ctx, 'owner');

    const parsed = z
      .object({ userId: z.string().min(1), role: z.enum(['owner', 'admin', 'member']) })
      .safeParse(input);
    if (!parsed.success) return err('That role is not valid.');

    return db.transaction(async (tx) => {
      await lockWorkspace(tx, ctx.workspaceId);

      const [target] = await tx
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)),
        )
        .limit(1);
      if (!target) return err('That person is not in this workspace.');

      if (
        target.role === 'owner' && parsed.data.role !== 'owner'
        && (await ownerCount(tx, ctx.workspaceId)) <= 1
      ) {
        return err('A workspace must keep at least one owner.');
      }

      await tx
        .update(member)
        .set({ role: parsed.data.role })
        .where(
          and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)),
        );

      return ok(null);
    });
  });
}

type RedeemableInvite = {
  id: string; organizationId: string; role: string | null;
  workspaceName: string; slug: string; inviterName: string | null;
};

/**
 * A pending, unexpired invitation addressed to this user, with its workspace.
 * Read-only: opening the link only shows it, since mail scanners and link
 * previews fetch invite URLs without the invitee meaning to join.
 */
async function loadRedeemable(userEmail: string, invitationId: string): Promise<Result<RedeemableInvite>> {
  const [invite] = await db
    .select({
      id: invitation.id, organizationId: invitation.organizationId, email: invitation.email,
      role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt,
      workspaceName: organization.name, slug: organization.slug, inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, invitationId))
    .limit(1);

  if (!invite || invite.status !== 'pending') return err('This invitation is no longer valid.');
  if (invite.expiresAt.getTime() < Date.now()) return err('This invitation has expired.');
  // Bound to the invited address, so a forwarded link cannot be redeemed by
  // whoever happens to open it.
  if (invite.email !== userEmail.toLowerCase()) {
    return err('This invitation was sent to a different email address.');
  }

  return ok({
    id: invite.id, organizationId: invite.organizationId, role: invite.role,
    workspaceName: invite.workspaceName, slug: invite.slug, inviterName: invite.inviterName,
  });
}

/** What the invite page shows before the user chooses to accept or decline. */
export async function getInvitationPreview(
  userEmail: string,
  invitationId: string,
): Promise<Result<{ workspaceName: string; role: string; inviterName: string | null }>> {
  return withAction(async () => {
    const found = await loadRedeemable(userEmail, invitationId);
    if (!found.ok) return found;
    const { workspaceName, role, inviterName } = found.data;
    return ok({ workspaceName, role: role ?? 'member', inviterName });
  });
}

/**
 * Takes the redeeming user's own id and email (Amendment A): the action wrapper
 * reads both from the session, never from the caller.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  invitationId: string,
): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const found = await loadRedeemable(userEmail, invitationId);
    if (!found.ok) return found;
    const invite = found.data;

    const accepted = await db.transaction(async (tx) => {
      // Claim the invite first, so two tabs redeeming it at once add one membership.
      const [claimed] = await tx
        .update(invitation)
        .set({ status: 'accepted' })
        .where(and(eq(invitation.id, invite.id), eq(invitation.status, 'pending')))
        .returning({ id: invitation.id });
      if (!claimed) return false;

      const [already] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, invite.organizationId), eq(member.userId, userId)))
        .limit(1);

      if (!already) {
        await tx.insert(member).values({
          id: newId(), organizationId: invite.organizationId, userId,
          role: invite.role ?? 'member',
        });
      }
      return true;
    });
    if (!accepted) return err('This invitation is no longer valid.');

    return ok({ slug: invite.slug });
  });
}

/** Same rules as acceptInvitation; the invitation is spent either way. */
export async function declineInvitation(
  userEmail: string,
  invitationId: string,
): Promise<Result<null>> {
  return withAction(async () => {
    const found = await loadRedeemable(userEmail, invitationId);
    if (!found.ok) return found;

    const [declined] = await db
      .update(invitation)
      .set({ status: 'rejected' })
      .where(and(eq(invitation.id, found.data.id), eq(invitation.status, 'pending')))
      .returning({ id: invitation.id });
    if (!declined) return err('This invitation is no longer valid.');

    return ok(null);
  });
}
