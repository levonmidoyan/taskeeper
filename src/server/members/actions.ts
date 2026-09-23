'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { changeMemberRole, inviteMember, removeMember } from './service';

/**
 * Slug-taking wrappers only (Amendment A). acceptInvitation is deliberately not
 * exported here: it takes the redeeming user's id, which a caller must never
 * supply. Cache invalidation lives here because revalidatePath needs a request.
 */

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
