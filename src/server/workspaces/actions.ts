'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { listMyWorkspaces } from './queries';
import { createWorkspaceForUser, deleteWorkspace } from './service';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name your workspace.').max(64, 'Keep it under 64 characters.'),
});

/**
 * Derives the user from the session itself rather than accepting one, since
 * every export of this module is a public HTTP endpoint reachable by anyone who
 * can send the same POST.
 */
export async function createWorkspaceAction(
  input: { name: string },
): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return err('You need to sign in first.');

    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const { slug } = await createWorkspaceForUser(session.user.id, parsed.data.name);
    return ok({ slug });
  });
}

/** Deletes the workspace, then says where to go: the user's next workspace, or making a new one. */
export async function deleteWorkspaceAction(
  workspaceSlug: string,
  input: { confirmName: string },
): Promise<Result<{ next: string }>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    const result = await deleteWorkspace(ctx, input);
    if (!result.ok) return result;

    // Every remaining workspace's switcher listed this one.
    revalidatePath('/', 'layout');
    const [next] = await listMyWorkspaces(ctx.userId);
    return ok({ next: next ? `/${next.slug}` : '/new-workspace' });
  });
}
