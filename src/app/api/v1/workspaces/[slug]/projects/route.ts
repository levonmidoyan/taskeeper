import { ok } from '@/lib/result';
import { listProjectsEndpoint } from '@/server/api/contract/projects';
import { apiRoute } from '@/server/api/route';
import { serializeProject } from '@/server/api/serialize';
import { listProjects } from '@/server/projects/queries';

export const GET = apiRoute(listProjectsEndpoint, async ({ ctx }) =>
  ok({ data: (await listProjects(ctx)).map(serializeProject) }));
