import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween, positionsAfter } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';

/**
 * Columns are project structure, not task data: creating, renaming, reordering
 * and deleting them is an owner/admin action, while any member can still move
 * tasks between them. Every write goes through requireRole first — services
 * throw, and withAction converts the ForbiddenError into a Result.
 */

/** A board stays readable at this width, and it bounds the reorder queries. */
const MAX_STATUSES = 12;

const nameSchema = z
  .string().trim().min(1, 'Name the column.').max(32, 'Keep it under 32 characters.');

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

    const [existing] = await db
      .select({ total: count() })
      .from(taskStatus)
      .where(eq(taskStatus.projectId, parsed.data.projectId));
    if ((existing?.total ?? 0) >= MAX_STATUSES) {
      return err(`A project can have at most ${MAX_STATUSES} columns.`);
    }

    const [last] = await db
      .select({ position: taskStatus.position })
      .from(taskStatus)
      .where(eq(taskStatus.projectId, parsed.data.projectId))
      .orderBy(desc(taskStatus.position))
      .limit(1);

    const id = newId();
    await db.insert(taskStatus).values({
      id,
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      color: parsed.data.color ?? 'muted',
      position: positionBetween(last?.position ?? null, null),
      isDone: parsed.data.isDone ?? false,
    });

    return ok({ id });
  });
}

export const updateStatusSchema = z.object({
  statusId: z.string().min(1),
  name: nameSchema.optional(),
  color: z.string().max(32).optional(),
  isDone: z.boolean().optional(),
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

    const neighbourPosition = async (id: string | null) => {
      if (!id) return null;
      if (id === owned.id) return undefined;
      const [row] = await db
        .select({ position: taskStatus.position })
        .from(taskStatus)
        // Scoped to the same project: a neighbour from another board would
        // produce a key that sorts this column into a nonsense place.
        .where(and(eq(taskStatus.id, id), eq(taskStatus.projectId, owned.projectId)))
        .limit(1);
      return row?.position;
    };

    const [before, after] = await Promise.all([
      neighbourPosition(parsed.data.beforeId),
      neighbourPosition(parsed.data.afterId),
    ]);

    if (before === undefined || after === undefined) return err('That move is not valid.');

    const position = positionBetween(before, after);
    await db.update(taskStatus).set({ position }).where(eq(taskStatus.id, owned.id));

    return ok({ position });
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

      // Read-then-write inside the transaction: outside it, a task created in
      // this column between the count and the DELETE would hit the RESTRICT
      // constraint and fail the request with a database error.
      const holdouts = await tx
        .select({ id: task.id, completedAt: task.completedAt })
        .from(task)
        .where(and(eq(task.statusId, owned.id), eq(task.workspaceId, ctx.workspaceId)))
        .orderBy(asc(task.position));

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

        const [last] = await tx
          .select({ position: task.position })
          .from(task)
          .where(and(eq(task.projectId, owned.projectId), eq(task.statusId, target.id)))
          .orderBy(desc(task.position))
          .limit(1);

        const positions = positionsAfter(last?.position ?? null, holdouts.length);
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

      return ok(null);
    });
  });
}
