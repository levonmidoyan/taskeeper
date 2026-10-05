import { ok } from '@/lib/result';
import { listLabelsEndpoint } from '@/server/api/contract/workspaces';
import { apiRoute } from '@/server/api/route';
import { serializeLabel } from '@/server/api/serialize';
import { listLabels } from '@/server/labels/queries';

export const GET = apiRoute(listLabelsEndpoint, async ({ ctx }) =>
  ok({ data: (await listLabels(ctx)).map(serializeLabel) }));
