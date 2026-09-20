import { eq } from 'drizzle-orm';
import { db, member, organization, workspaceSettings } from '@/db';
import { newId } from '@/lib/ids';
import { slugify } from '@/lib/slug';

async function uniqueSlug(base: string): Promise<string> {
  const [taken] = await db
    .select({ id: organization.id }).from(organization).where(eq(organization.slug, base)).limit(1);
  if (!taken) return base;
  // Suffix rather than a counter: a counter would need a second round-trip per
  // attempt under concurrent creation.
  return `${base}-${newId().slice(0, 6).toLowerCase()}`;
}

/**
 * Takes a userId rather than a WorkspaceContext: this is the one mutation that
 * runs before any workspace exists, so there is no context to pass yet. Never
 * exported from actions.ts directly — an exported ctx-free, userId-taking
 * function on a 'use server' module would let any caller create a workspace
 * owned by another user.
 */
export async function createWorkspaceForUser(userId: string, name: string) {
  const id = newId();
  const slug = await uniqueSlug(slugify(name));

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id, name: name.trim(), slug });
    await tx.insert(workspaceSettings).values({ workspaceId: id });
    await tx.insert(member).values({
      id: newId(), organizationId: id, userId, role: 'owner',
    });
  });

  return { id, slug };
}
