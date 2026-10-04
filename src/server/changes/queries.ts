import { and, eq } from 'drizzle-orm';
import { db, member, organization, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export async function getWorkspaceVersion(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ version: workspaceChange.version })
    .from(workspaceChange)
    .where(eq(workspaceChange.workspaceId, ctx.workspaceId))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * The poll endpoint's one read: the counter, only for a member. null for a
 * non-member and for an unknown slug alike, so the answer leaks nothing.
 */
export async function pollWorkspaceVersion(userId: string, slug: string): Promise<number | null> {
  const [row] = await db
    .select({ version: workspaceChange.version })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .leftJoin(workspaceChange, eq(workspaceChange.workspaceId, organization.id))
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!row) return null;
  return row.version ?? 0;
}
