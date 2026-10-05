import { ok } from '@/lib/result';
import { createTaskEndpoint, listTasksEndpoint } from '@/server/api/contract/tasks';
import { findApiTask, listApiTasks, taskNotFound } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';
import { serializeTask } from '@/server/api/serialize';
import { createTask } from '@/server/tasks/service';

export const GET = apiRoute(listTasksEndpoint, async ({ ctx, query }) => ok(await listApiTasks(ctx, query)));

export const POST = apiRoute(createTaskEndpoint, async ({ ctx, body }) => {
  const created = await createTask(ctx, body);
  if (!created.ok) return created;
  const row = await findApiTask(ctx, created.data.id);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});
