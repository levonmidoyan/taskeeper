import { ok } from '@/lib/result';
import { listMembersEndpoint } from '@/server/api/contract/workspaces';
import { apiRoute } from '@/server/api/route';
import { serializeMember } from '@/server/api/serialize';
import { listWorkspaceMembers } from '@/server/labels/queries';

export const GET = apiRoute(listMembersEndpoint, async ({ ctx }) =>
  ok({ data: (await listWorkspaceMembers(ctx)).map(serializeMember) }));
