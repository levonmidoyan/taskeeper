import { err, ok } from '@/lib/result';
import { deleteTaskEndpoint, getTaskEndpoint, updateTaskEndpoint } from '@/server/api/contract/tasks';
import { findApiTask, taskNotFound } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';
import { serializeTask } from '@/server/api/serialize';
import { listLabels } from '@/server/labels/queries';
import { setTaskLabels } from '@/server/labels/service';
import { deleteTask, updateTask } from '@/server/tasks/service';

export const GET = apiRoute(getTaskEndpoint, async ({ ctx, params }) => {
  const row = await findApiTask(ctx, params.taskId);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});

export const PATCH = apiRoute(updateTaskEndpoint, async ({ ctx, params, body }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  const { labelIds, ...fields } = body;

  // Checked before any write: the field update and the label write are two
  // services, and a bad label id must not leave the fields half-applied.
  if (labelIds) {
    const known = new Set((await listLabels(ctx)).map((l) => l.id));
    if (labelIds.some((id) => !known.has(id))) return err('Unknown label.');
  }
  if (Object.values(fields).some((v) => v !== undefined)) {
    const updated = await updateTask(ctx, { taskId: params.taskId, ...fields });
    if (!updated.ok) return updated;
  }
  if (labelIds) {
    const labelled = await setTaskLabels(ctx, { taskId: params.taskId, labelIds });
    if (!labelled.ok) return labelled;
  }

  const row = await findApiTask(ctx, params.taskId);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});

export const DELETE = apiRoute(deleteTaskEndpoint, async ({ ctx, params }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  return deleteTask(ctx, { taskId: params.taskId });
});
