'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { err, ok, withAction, type Result } from '@/lib/result';
import { createWorkspaceForUser } from './service';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name your workspace.').max(64, 'Keep it under 64 characters.'),
});

/**
 * The only export here that touches a workspace: it derives the user from the
 * session itself rather than accepting one, since every export of this module
 * is a public HTTP endpoint reachable by anyone who can send the same POST.
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
