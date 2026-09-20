import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { db, member, organization, workspaceSettings } from '@/db';
import { auth } from '@/lib/auth';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { ForbiddenError } from '@/lib/result';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  slug: string;
  role: WorkspaceRole;
  timezone: string;
};

/**
 * The tenant-isolation core, kept free of Next.js request APIs so it can be
 * tested directly. Resolution is by URL slug plus a membership row — never from
 * the session's active organization, so two tabs on two workspaces both work.
 */
export async function resolveWorkspace(
  userId: string,
  slug: string,
): Promise<WorkspaceContext | null> {
  const [row] = await db
    .select({
      workspaceId: organization.id,
      slug: organization.slug,
      role: member.role,
      timezone: workspaceSettings.timezone,
    })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, userId)),
    )
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(eq(organization.slug, slug))
    .limit(1);

  if (!row) return null;

  return {
    userId,
    workspaceId: row.workspaceId,
    slug: row.slug,
    role: row.role as WorkspaceRole,
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
  };
}

/** Server-component and action entry point. Redirects or 404s rather than returning null. */
export async function requireWorkspace(slug: string): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const ctx = await resolveWorkspace(session.user.id, slug);
  // 404, not 403: a non-member must not be able to learn which slugs exist.
  if (!ctx) notFound();

  return ctx;
}

export function requireRole(ctx: WorkspaceContext, ...roles: WorkspaceRole[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}
