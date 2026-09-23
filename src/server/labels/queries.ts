import { asc, eq } from 'drizzle-orm';
import { db, label, member, user } from '@/db';
import type { WorkspaceContext, WorkspaceRole } from '@/lib/session';
import type { LabelRow } from '@/server/tasks/queries';

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

export async function listLabels(ctx: WorkspaceContext): Promise<LabelRow[]> {
  return db
    .select({ id: label.id, name: label.name, color: label.color })
    .from(label)
    .where(eq(label.workspaceId, ctx.workspaceId))
    .orderBy(asc(label.name));
}

/** Lives here rather than in members/ because the assignee picker needs it first. */
export async function listWorkspaceMembers(ctx: WorkspaceContext): Promise<MemberRow[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.workspaceId))
    .orderBy(asc(user.name));

  return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }));
}
