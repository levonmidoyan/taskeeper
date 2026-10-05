import { ok } from '@/lib/result';
import { createCommentEndpoint, listCommentsEndpoint } from '@/server/api/contract/comments';
import { findApiTask, listApiComments, taskNotFound } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';
import { createComment } from '@/server/comments/service';

export const GET = apiRoute(listCommentsEndpoint, async ({ ctx, params }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  return ok({ data: await listApiComments(ctx, params.taskId) });
});

export const POST = apiRoute(createCommentEndpoint, async ({ ctx, params, body }) => {
  if (!(await findApiTask(ctx, params.taskId))) return taskNotFound();
  const created = await createComment(ctx, { taskId: params.taskId, body: body.body });
  if (!created.ok) return created;
  const made = (await listApiComments(ctx, params.taskId)).find((c) => c.id === created.data.id);
  return made ? ok(made) : taskNotFound();
});
