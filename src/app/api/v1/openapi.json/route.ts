import { appUrl } from '@/lib/url';
import { endpoints } from '@/server/api/contract';
import { buildOpenApi } from '@/server/api/openapi';

/** Public: the contract is not a secret, and tools fetch it without a token. */
export function GET() {
  return Response.json(buildOpenApi(endpoints, appUrl()), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
