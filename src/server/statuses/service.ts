import { and, count, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { STATUS_ICON_KEYS } from '@/lib/status-icons';
import { byId, byKey, positionBetween, positionsAfter, positionsForCount } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';
import { emitChange } from '@/server/changes/service';
import { lastTaskPosition, lockColumns } from '@/server/tasks/columns';

/**
 * Columns are project structure, not task data: creating, renaming, reordering
 * and deleting them is an owner/admin action, while any member can still move
 * tasks between them. Every write goes through requireRole first — services
 * throw, and withAction converts the ForbiddenError into a Result.
 */

/** A board stays readable at this width, and it bounds the reorder queries. */
const MAX_STATUSES = 12;

const STALE_MOVE = 'The columns changed while you were dragging. Try again.';

const nameSchema = z
  .string().trim().min(1, 'Name the column.').max(32, 'Keep it under 32 characters.');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the project's row for the rest of the transaction, so writes that
 * place its columns run one at a time and each reads the keys the previous one
 * left: two appends would otherwise take the same key, and two reorders into
 * one gap would land on the same one. NO KEY UPDATE does not block the
 * key-share locks that inserting a row referencing the project takes.
 */
async function lockProjectColumns(tx: Tx, projectId: string): Promise<void> {
  await tx.select({ id: project.id }).from(project)
    .where(eq(project.id, projectId)).for('no key update');
}

type OwnedStatus = { id: string; projectId: string; position: string; isDone: boolean };

/** Confirms a status belongs to a project that belongs to this workspace. */
async function loadOwnedStatus(
  ctx: WorkspaceContext,
  statusId: string,
): Promise<OwnedStatus | null> {
  const [row] = await db
    .select({
      id: taskStatus.id,
      projectId: taskStatus.projectId,
      position: taskStatus.position,
      isDone: taskStatus.isDone,
    })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    // The id alone would read — and write — across tenants.
    .where(and(eq(taskStatus.id, statusId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

export const createStatusSchema = z.object({
  projectId: z.string().min(1),
  name: nameSchema,
  color: z.string().max(32).optional(),
  isDone: z.boolean().optional(),
});

export type CreateStatusInput = z.input<typeof createStatusSchema>;

/** Appends a column to the right-hand end of the board. */
export async function createStatus(
  ctx: WorkspaceContext,
  input: CreateStatusInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = createStatusSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Project not found.');

    return db.transaction(async (tx) => {
      // Counted and appended under the lock, so concurrent creates neither
      // share a key nor together pass the column limit.
      await lockProjectColumns(tx, parsed.data.projectId);

      const [existing] = await tx
        .select({ total: count() })
        .from(taskStatus)
        .where(eq(taskStatus.projectId, parsed.data.projectId));
      if ((existing?.total ?? 0) >= MAX_STATUSES) {
        return err(`A project can have at most ${MAX_STATUSES} columns.`);
      }

      const [last] = await tx
        .select({ position: taskStatus.position })
        .from(taskStatus)
        .where(eq(taskStatus.projectId, parsed.data.projectId))
        .orderBy(desc(byKey(taskStatus.position)))
        .limit(1);

      const id = newId();
      await tx.insert(taskStatus).values({
        id,
        projectId: parsed.data.projectId,
        name: parsed.data.name,
        color: parsed.data.color ?? 'muted',
        position: positionBetween(last?.position ?? null, null),
        isDone: parsed.data.isDone ?? false,
      });
      await emitChange(ctx, { projectId: parsed.data.projectId }, tx);

      return ok({ id });
    });
  });
}

export const updateStatusSchema = z.object({
  statusId: z.string().min(1),
  name: nameSchema.optional(),
  color: z.string().max(32).optional(),
  isDone: z.boolean().optional(),
  /** null resets the column to its derived glyph. */
  icon: z.enum(STATUS_ICON_KEYS).nullable().optional(),
});

export type UpdateStatusInput = z.input<typeof updateStatusSchema>;

export async function updateStatus(
  ctx: WorkspaceContext,
  input: UpdateStatusInput,
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = updateStatusSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const owned = await loadOwnedStatus(ctx, parsed.data.statusId);
    if (!owned) return err('Column not found.');

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.color !== undefined) patch.color = parsed.data.color;
    if (parsed.data.isDone !== undefined) patch.isDone = parsed.data.isDone;
    if (parsed.data.icon !== undefined) patch.icon = parsed.data.icon;
    if (Object.keys(patch).length === 0) return ok(null);

    const flipsDone = parsed.data.isDone !== undefined && parsed.data.isDone !== owned.isDone;

    // Turning the last open column into a done column would leave the checkbox
    // with nowhere to send a task back to (see doneToggleTarget).
    if (flipsDone) {
      const [remaining] = await db
        .select({ total: count() })
        .from(taskStatus)
        .where(
          and(
            eq(taskStatus.projectId, owned.projectId),
            ne(taskStatus.id, owned.id),
            eq(taskStatus.isDone, !parsed.data.isDone),
          ),
        );
      if ((remaining?.total ?? 0) === 0) {
        return err(
          parsed.data.isDone
            ? 'A project needs at least one column that is not a done column.'
            : 'A project needs at least one done column.',
        );
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(taskStatus).set(patch).where(eq(taskStatus.id, owned.id));

      // completed_at follows the column's is_done flag (spec §3.2), so flipping
      // the flag has to carry the tasks already sitting in the column with it —
      // otherwise the board says "done" while the task row says otherwise.
      if (flipsDone) {
        await tx
          .update(task)
          .set({
            // coalesce, not a fresh timestamp: a task that was already carrying
            // a completion time keeps it, matching moveTask.
            completedAt: parsed.data.isDone
              ? sql`coalesce(${task.completedAt}, now())`
              : null,
            updatedAt: new Date(),
          })
          .where(and(eq(task.statusId, owned.id), eq(task.workspaceId, ctx.workspaceId)));
      }
      await emitChange(ctx, { projectId: owned.projectId }, tx);
    });

    return ok(null);
  });
}

export const moveStatusSchema = z.object({
  statusId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type MoveStatusInput = z.input<typeof moveStatusSchema>;

/**
 * Reorders a column. Like a task drop, the client sends the neighbours it saw
 * and the server computes the key, so two concurrent reorders cannot agree on
 * the same one.
 */
export async function moveStatus(
  ctx: WorkspaceContext,
  input: MoveStatusInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = moveStatusSchema.safeParse(input);
    if (!parsed.success) return err('That move is not valid.');

    const owned = await loadOwnedStatus(ctx, parsed.data.statusId);
    if (!owned) return err('Column not found.');

    return db.transaction(async (tx) => {
      // Neighbours are read under the lock: two reorders into one gap that both
      // read its keys first would compute the same key between them.
      await lockProjectColumns(tx, owned.projectId);

      const neighbourPosition = async (id: string | null) => {
        if (!id) return null;
        if (id === owned.id) return undefined;
        const [row] = await tx
          .select({ position: taskStatus.position })
          .from(taskStatus)
          // Scoped to the same project: a neighbour from another board would
          // produce a key that sorts this column into a nonsense place.
          .where(and(eq(taskStatus.id, id), eq(taskStatus.projectId, owned.projectId)))
          .limit(1);
        return row?.position;
      };

      const before = await neighbourPosition(parsed.data.beforeId);
      const after = await neighbourPosition(parsed.data.afterId);

      if (before === undefined || after === undefined) return err('That move is not valid.');
      // Reversed neighbours mean someone reordered the columns since this dialog
      // loaded. Tied keys are ordered by id (codepoint, as the board query sorts them).
      if (before !== null && after !== null) {
        if (before > after) return err(STALE_MOVE);
        if (before === after && parsed.data.beforeId! > parsed.data.afterId!) return err(STALE_MOVE);
      }

      if (before === null || before !== after) {
        // Against the column right after `before` now, not the neighbour the
        // client saw: a reorder that has landed in the same gap since sits
        // there, and a key between `before` and it is still unused.
        const [next] = await tx
          .select({ position: taskStatus.position })
          .from(taskStatus)
          .where(
            and(
              eq(taskStatus.projectId, owned.projectId),
              ne(taskStatus.id, owned.id),
              before === null ? undefined : gt(byKey(taskStatus.position), before),
            ),
          )
          .orderBy(byKey(taskStatus.position))
          .limit(1);
        const position = positionBetween(before, next?.position ?? null);
        await tx.update(taskStatus).set({ position }).where(eq(taskStatus.id, owned.id));
        await emitChange(ctx, { projectId: owned.projectId }, tx);
        return ok({ position });
      }

      // Two columns share a key, so nothing fits between them. Renumber the
      // project's columns in their displayed order, then place this one.
      const columns = await tx
        .select({ id: taskStatus.id })
        .from(taskStatus)
        .where(and(eq(taskStatus.projectId, owned.projectId), ne(taskStatus.id, owned.id)))
        .orderBy(byKey(taskStatus.position), byId(taskStatus.id));
      const keys = positionsForCount(columns.length);
      const renumbered = new Map(columns.map((row, i) => [row.id, keys[i]]));
      for (const [id, key] of renumbered) {
        await tx.update(taskStatus).set({ position: key }).where(eq(taskStatus.id, id));
      }
      const position = positionBetween(
        renumbered.get(parsed.data.beforeId!)!,
        renumbered.get(parsed.data.afterId!)!,
      );
      await tx.update(taskStatus).set({ position }).where(eq(taskStatus.id, owned.id));
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ position });
    });
  });
}

export const deleteStatusSchema = z.object({
  statusId: z.string().min(1),
  reassignToId: z.string().nullable().optional(),
});

export type DeleteStatusInput = z.input<typeof deleteStatusSchema>;

/**
 * Deletes a column. task.status_id is RESTRICT (spec §3.2), so a column holding
 * tasks can only go once those tasks have somewhere else to be: the caller names
 * the column they move to, and they land at its end in their existing order.
 */
export async function deleteStatus(
  ctx: WorkspaceContext,
  input: DeleteStatusInput,
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = deleteStatusSchema.safeParse(input);
    if (!parsed.success) return err('That column is not valid.');

    const owned = await loadOwnedStatus(ctx, parsed.data.statusId);
    if (!owned) return err('Column not found.');

    const reassignToId = parsed.data.reassignToId ?? null;
    if (reassignToId === owned.id) return err('Pick a different column to move the tasks to.');

    return db.transaction(async (tx) => {
      // Both columns, before anything is read: a task created in this column
      // after the holdout read would hit the RESTRICT constraint on delete, and
      // one appended to the target at the same moment would share a key.
      await lockColumns(tx, reassignToId ? [owned.id, reassignToId] : [owned.id]);

      const siblings = await tx
        .select({ id: taskStatus.id, isDone: taskStatus.isDone })
        .from(taskStatus)
        .where(and(eq(taskStatus.projectId, owned.projectId), ne(taskStatus.id, owned.id)));

      if (siblings.length === 0) return err('A project needs at least one column.');
      if (!owned.isDone && siblings.every((s) => s.isDone)) {
        return err('A project needs at least one column that is not a done column.');
      }
      if (owned.isDone && !siblings.some((s) => s.isDone)) {
        return err('A project needs at least one done column.');
      }

      const holdouts = await tx
        .select({ id: task.id, completedAt: task.completedAt })
        .from(task)
        .where(and(eq(task.statusId, owned.id), eq(task.workspaceId, ctx.workspaceId)))
        .orderBy(byKey(task.position), byId(task.id));

      if (holdouts.length > 0) {
        const target = reassignToId
          ? siblings.find((s) => s.id === reassignToId)
          : undefined;
        if (!target) {
          return err(
            reassignToId
              ? 'That column does not belong to this project.'
              : `Move this column’s ${holdouts.length} task${holdouts.length === 1 ? '' : 's'} to another column first.`,
          );
        }

        const last = await lastTaskPosition(tx, owned.projectId, target.id);
        const positions = positionsAfter(last, holdouts.length);
        const now = new Date();

        for (const [i, row] of holdouts.entries()) {
          await tx
            .update(task)
            .set({
              statusId: target.id,
              position: positions[i],
              // The same rule as every other status change: completion is the
              // column, so the flag of the column they arrive in decides.
              completedAt: target.isDone ? (row.completedAt ?? now) : null,
              updatedAt: now,
            })
            .where(eq(task.id, row.id));
        }
      }

      await tx.delete(taskStatus).where(eq(taskStatus.id, owned.id));
      await emitChange(ctx, { projectId: owned.projectId }, tx);

      return ok(null);
    });
  });
}
