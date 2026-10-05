import { ok } from '@/lib/result';
import { listWorkspacesEndpoint } from '@/server/api/contract/workspaces';
import { apiRoute } from '@/server/api/route';
import { serializeWorkspace } from '@/server/api/serialize';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export const GET = apiRoute(listWorkspacesEndpoint, async ({ ctx }) =>
  ok({ data: (await listMyWorkspaces(ctx.userId)).map(serializeWorkspace) }));
