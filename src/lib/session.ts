import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { db, member, organization, userSettings, workspaceSettings } from '@/db';
import { auth } from '@/lib/auth';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { safeNextPath } from '@/lib/next-path';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';
import { ForbiddenError } from '@/lib/result';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/** Who is acting, for account-level services that have no workspace in the URL. */
export type UserContext = { userId: string };

export type WorkspaceContext = UserContext & {
  workspaceId: string;
  slug: string;
  role: WorkspaceRole;
  /** The zone this user sees dates in: their own if set, else the workspace's. */
  timezone: string;
  /** The workspace's zone, for anything that must be the same for every member. */
  workspaceTimezone: string;
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
      workspaceTimezone: workspaceSettings.timezone,
      userTimezone: userSettings.timezone,
    })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, userId)),
    )
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .leftJoin(userSettings, eq(userSettings.userId, userId))
    .where(eq(organization.slug, slug))
    .limit(1);

  if (!row) return null;

  const workspaceTimezone = row.workspaceTimezone ?? DEFAULT_TIMEZONE;
  return {
    userId,
    workspaceId: row.workspaceId,
    slug: row.slug,
    role: row.role as WorkspaceRole,
    timezone: row.userTimezone ?? workspaceTimezone,
    workspaceTimezone,
  };
}

/** Sends a signed-out visitor to sign in, and back to the page they asked for after. */
export async function signInRedirect(): Promise<never> {
  const path = safeNextPath((await headers()).get(REQUEST_PATH_HEADER), '');
  redirect(path && path !== '/' ? `/auth/sign-in?redirectTo=${encodeURIComponent(path)}` : '/auth/sign-in');
}

/** Account-level entry point: the signed-in user, or a redirect to sign in. */
export async function requireUser(): Promise<UserContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();
  return { userId: session.user.id };
}

/** Server-component and action entry point. Redirects or 404s rather than returning null. */
export async function requireWorkspace(slug: string): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();

  const ctx = await resolveWorkspace(session.user.id, slug);
  // 404, not 403: a non-member must not be able to learn which slugs exist.
  if (!ctx) notFound();

  return ctx;
}

export function requireRole(ctx: WorkspaceContext, ...roles: WorkspaceRole[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}
