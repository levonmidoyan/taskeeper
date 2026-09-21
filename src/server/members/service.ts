import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, invitation, member, organization, user } from '@/db';
import { sendInviteEmail } from '@/lib/email';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';

const INVITE_TTL_DAYS = 7;

async function ownerCount(workspaceId: string): Promise<number> {
  const [row] = await db
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

    await sendInviteEmail(
      parsed.data.email,
      `${process.env.BETTER_AUTH_URL}/invite/${id}`,
      ws?.name ?? 'the workspace',
    );

    return ok({ invitationId: id });
  });
}

export async function removeMember(
  ctx: WorkspaceContext,
  input: { userId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const [target] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)))
      .limit(1);
    if (!target) return err('That person is not in this workspace.');

    // Removing the last owner would leave nobody able to manage the workspace.
    if (target.role === 'owner' && (await ownerCount(ctx.workspaceId)) <= 1) {
      return err('A workspace must keep at least one owner.');
    }
    if (target.role === 'owner') requireRole(ctx, 'owner');

    await db
      .delete(member)
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)));

    return ok(null);
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

    const [target] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)),
      )
      .limit(1);
    if (!target) return err('That person is not in this workspace.');

    if (
      target.role === 'owner' && parsed.data.role !== 'owner'
      && (await ownerCount(ctx.workspaceId)) <= 1
    ) {
      return err('A workspace must keep at least one owner.');
    }

    await db
      .update(member)
      .set({ role: parsed.data.role })
      .where(
        and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)),
      );

    return ok(null);
  });
}

/**
 * Takes the redeeming user's own id and email (Amendment A): as a Server Action
 * this would let any caller redeem an invitation as somebody else.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  invitationId: string,
): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const [invite] = await db
      .select({
        id: invitation.id, organizationId: invitation.organizationId, email: invitation.email,
        role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1);

    if (!invite || invite.status !== 'pending') return err('This invitation is no longer valid.');
    if (invite.expiresAt.getTime() < Date.now()) return err('This invitation has expired.');
    // Bound to the invited address, so a forwarded link cannot be redeemed by
    // whoever happens to open it.
    if (invite.email !== userEmail.toLowerCase()) {
      return err('This invitation was sent to a different email address.');
    }

    const [org] = await db
      .select({ slug: organization.slug })
      .from(organization).where(eq(organization.id, invite.organizationId)).limit(1);
    if (!org) return err('That workspace no longer exists.');

    await db.transaction(async (tx) => {
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
      await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invite.id));
    });

    return ok({ slug: org.slug });
  });
}
