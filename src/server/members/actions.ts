'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { listMyWorkspaces } from '@/server/workspaces/queries';
import {
  acceptInvitation, changeMemberRole, declineInvitation, inviteMember, leaveWorkspace, removeMember,
} from './service';

/**
 * Slug-taking wrappers (Amendment A), plus the two invitation answers, which
 * take only the invitation id: the redeeming user's id and email come from the
 * session, never from the caller. Cache invalidation lives here because
 * revalidatePath needs a request.
 */

const SIGNED_OUT = 'Sign in to answer this invitation.';

export async function acceptInvitationAction(invitationId: string): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return err(SIGNED_OUT);
    const result = await acceptInvitation(session.user.id, session.user.email, String(invitationId));
    if (result.ok) revalidatePath('/', 'layout');
    return result;
  });
}

export async function declineInvitationAction(invitationId: string): Promise<Result<null>> {
  return withAction(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return err(SIGNED_OUT);
    return declineInvitation(session.user.email, String(invitationId));
  });
}

export async function inviteMemberAction(
  workspaceSlug: string,
  input: { email: string; role: 'admin' | 'member' },
): Promise<Result<{ invitationId: string }>> {
  return withAction(async () => {
    const result = await inviteMember(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function removeMemberAction(
  workspaceSlug: string,
  input: { userId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await removeMember(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

/** Leaves the workspace, then says where to go: the user's next workspace, or making a new one. */
export async function leaveWorkspaceAction(workspaceSlug: string): Promise<Result<{ next: string }>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    const result = await leaveWorkspace(ctx);
    if (!result.ok) return result;

    // The leaver's switcher listed this workspace in every layout.
    revalidatePath('/', 'layout');
    const [next] = await listMyWorkspaces(ctx.userId);
    return ok({ next: next ? `/${next.slug}` : '/new-workspace' });
  });
}

export async function changeMemberRoleAction(
  workspaceSlug: string,
  input: { userId: string; role: 'owner' | 'admin' | 'member' },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await changeMemberRole(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
