import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, label, task, taskLabel } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import type { LabelRow } from '@/server/tasks/queries';

const nameSchema = z
  .string().trim().min(1, 'Name the label.').max(32, 'Keep it under 32 characters.');

export async function createLabel(
  ctx: WorkspaceContext,
  input: { name: string; color?: string },
): Promise<Result<LabelRow>> {
  return withAction(async () => {
    const parsed = z.object({ name: nameSchema, color: z.string().optional() }).safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    // Typing an existing name in the picker must attach that label, not error out,
    // so a duplicate returns the existing row.
    const [existing] = await db
      .select({ id: label.id, name: label.name, color: label.color })
      .from(label)
      .where(and(eq(label.workspaceId, ctx.workspaceId), eq(label.name, parsed.data.name)))
      .limit(1);

    if (existing) return ok(existing);

    const row = {
      id: newId(),
      workspaceId: ctx.workspaceId,
      name: parsed.data.name,
      color: parsed.data.color ?? 'muted',
    };
    await db.insert(label).values(row);

    return ok({ id: row.id, name: row.name, color: row.color });
  });
}

export async function setTaskLabels(
  ctx: WorkspaceContext,
  input: { taskId: string; labelIds: string[] },
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z
      .object({ taskId: z.string().min(1), labelIds: z.array(z.string()).max(20) })
      .safeParse(input);
    if (!parsed.success) return err('That label selection is not valid.');

    const [owned] = await db
      .select({ id: task.id, projectId: task.projectId })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    // Deduplicated first: task_label is keyed on (task_id, label_id), so a repeated
    // id would break the insert, and comparing counts against a list holding the
    // same id twice would reject a perfectly valid selection.
    const labelIds = [...new Set(parsed.data.labelIds)];

    if (labelIds.length > 0) {
      // Every id must belong to this workspace, or the whole call is rejected.
      const valid = await db
        .select({ id: label.id })
        .from(label)
        .where(and(eq(label.workspaceId, ctx.workspaceId), inArray(label.id, labelIds)));
      if (valid.length !== labelIds.length) return err('Unknown label.');
    }

    await db.transaction(async (tx) => {
      await tx.delete(taskLabel).where(eq(taskLabel.taskId, parsed.data.taskId));
      if (labelIds.length > 0) {
        await tx.insert(taskLabel).values(
          labelIds.map((labelId) => ({ taskId: parsed.data.taskId, labelId })),
        );
      }
    });

    return ok(null);
  });
}

export async function deleteLabel(
  ctx: WorkspaceContext,
  input: { labelId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const deleted = await db
      .delete(label)
      .where(and(eq(label.id, input.labelId), eq(label.workspaceId, ctx.workspaceId)))
      .returning({ id: label.id });

    if (deleted.length === 0) return err('Label not found.');

    return ok(null);
  });
}
