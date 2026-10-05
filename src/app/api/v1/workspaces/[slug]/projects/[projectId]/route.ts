import { err, ok } from '@/lib/result';
import { getProjectEndpoint } from '@/server/api/contract/projects';
import { apiRoute } from '@/server/api/route';
import { serializeProject, serializeStatus } from '@/server/api/serialize';
import { getProject, listProjects } from '@/server/projects/queries';

export const GET = apiRoute(getProjectEndpoint, async ({ ctx, params }) => {
  // getProject has the statuses, listProjects the open count; both skip archived projects.
  const [detail, all] = await Promise.all([getProject(ctx, params.projectId), listProjects(ctx)]);
  const summary = all.find((p) => p.id === params.projectId);
  if (!detail || !summary) return err('Project not found.', 'not_found');
  return ok({ ...serializeProject(summary), statuses: detail.statuses.map(serializeStatus) });
});
