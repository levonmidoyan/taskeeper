import { ok } from '@/lib/result';
import { deleteTaskEndpoint, getTaskEndpoint, updateTaskEndpoint } from '@/server/api/contract/tasks';
import { findApiTask, taskNotFound } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';
import { serializeTask } from '@/server/api/serialize';
import { deleteTask, updateTaskAndLabels } from '@/server/tasks/service';

export const GET = apiRoute(getTaskEndpoint, async ({ ctx, params }) => {
  const row = await findApiTask(ctx, params.taskId);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});

export const PATCH = apiRoute(updateTaskEndpoint, async ({ ctx, params, body }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  const { labelIds, ...fields } = body;
  // One transaction: an unknown label leaves the fields untouched too.
  const updated = await updateTaskAndLabels(ctx, { taskId: params.taskId, ...fields }, labelIds);
  if (!updated.ok) return updated;

  const row = await findApiTask(ctx, params.taskId);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});

export const DELETE = apiRoute(deleteTaskEndpoint, async ({ ctx, params }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  return deleteTask(ctx, { taskId: params.taskId });
});
