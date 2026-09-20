import { eq } from 'drizzle-orm';
import { db, member, organization } from '@/db';
import type { WorkspaceRole } from '@/lib/session';

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

/**
 * Takes a userId rather than a WorkspaceContext: this is the one query that runs
 * before any workspace is chosen, so there is no context to pass yet.
 */
export async function listMyWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);

  return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }));
}
