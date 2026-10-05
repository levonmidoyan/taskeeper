import { err, ok } from '@/lib/result';
import { meEndpoint } from '@/server/api/contract/account';
import { getApiUser } from '@/server/api/queries';
import { apiRoute } from '@/server/api/route';

export const GET = apiRoute(meEndpoint, async ({ ctx }) => {
  const me = await getApiUser(ctx.userId);
  return me ? ok(me) : err('Not found.', 'not_found');
});
