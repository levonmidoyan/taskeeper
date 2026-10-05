import { APIError } from 'better-auth/api';
import { count, eq, inArray } from 'drizzle-orm';
import { db, member, organization, task } from '@/db';
import { purgeWorkspaceObjects } from '@/server/attachments/cleanup';
import { emitChangeFor } from '@/server/changes/service';

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every workspace the user belongs to, with whether they are its last owner and
 * whether anyone else is in it.
 */
async function memberships(tx: Tx, userId: string) {
  const rows = await tx
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const counts = await tx
    .select({ id: member.organizationId, role: member.role, n: count() })
    .from(member)
    .where(inArray(member.organizationId, ids))
    .groupBy(member.organizationId, member.role);

  return rows.map((r) => {
    const own = counts.filter((c) => c.id === r.id);
    const members = own.reduce((sum, c) => sum + c.n, 0);
    const owners = own.find((c) => c.role === 'owner')?.n ?? 0;
    return { ...r, solo: members === 1, lastOwner: r.role === 'owner' && owners === 1 };
  });
}

function blocked(names: string[]): APIError {
  return new APIError('BAD_REQUEST', {
    message:
      `You are the only owner of ${names.join(', ')}. ` +
      'Make another member an owner, or remove the other members, before deleting your account.',
  });
}

/**
 * Refuses the deletion while the user is the last owner of a workspace other
 * people still use: deleting them would leave it with nobody able to manage it.
 * Run before the confirmation email goes out, so the user hears about it at
 * once rather than after clicking the link.
 */
export async function assertAccountDeletable(userId: string): Promise<void> {
  const rows = await memberships(db, userId);
  const stuck = rows.filter((r) => r.lastOwner && !r.solo).map((r) => r.name);
  if (stuck.length > 0) throw blocked(stuck);
}

/**
 * Better Auth's beforeDelete hook. Re-checks (a member may have joined since the
 * email was sent), then deletes the workspaces nobody else is in — they would
 * otherwise be left with no members at all. Workspaces the user shares keep
 * their content; the user's name on it becomes "Deleted user" through the
 * ON DELETE SET NULL author columns.
 */
export async function prepareAccountDeletion(userId: string): Promise<void> {
  const deleted = await db.transaction(async (tx) => {
    const rows = await memberships(tx, userId);
    const stuck = rows.filter((r) => r.lastOwner && !r.solo).map((r) => r.name);
    if (stuck.length > 0) throw blocked(stuck);

    const solo = rows.filter((r) => r.solo).map((r) => r.id);
    if (solo.length > 0) {
      // Tasks first: task.status_id is RESTRICT, so cascading from the workspace
      // would leave the task / task_status delete order undefined (spec §3.2).
      await tx.delete(task).where(inArray(task.workspaceId, solo));
      await tx.delete(organization).where(inArray(organization.id, solo));
    }

    // Workspaces that keep going lose a member and show "Deleted user" from now on.
    // Last, so their counter rows stay locked only briefly, and in id order, so
    // two deletions sharing workspaces lock them the same way round.
    const shared = rows.filter((r) => !r.solo).map((r) => r.id).sort();
    for (const id of shared) await emitChangeFor(id, tx);
    return solo;
  });
  // After commit, so a rolled-back deletion keeps its files.
  await purgeWorkspaceObjects(deleted);
}
