import { err, ok } from '@/lib/result';
import { createTaskEndpoint, listTasksEndpoint } from '@/server/api/contract/tasks';
import { findApiTask, listApiTasks, taskNotFound } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';
import { serializeTask } from '@/server/api/serialize';
import { getProject } from '@/server/projects/queries';
import { createTask } from '@/server/tasks/service';

export const GET = apiRoute(listTasksEndpoint, async ({ ctx, query }) => {
  // An unknown or archived project is a 404, not an empty page.
  if (query.projectId && !(await getProject(ctx, query.projectId))) return err('Project not found.', 'not_found');
  return ok(await listApiTasks(ctx, query));
});

export const POST = apiRoute(createTaskEndpoint, async ({ ctx, body }) => {
  const created = await createTask(ctx, body);
  if (!created.ok) return created;
  const row = await findApiTask(ctx, created.data.id);
  return row ? ok(serializeTask(ctx.slug, row)) : taskNotFound();
});
