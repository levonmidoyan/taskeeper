import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveDownload } from '@/server/attachments/download';

/**
 * Opens or downloads an attachment. Every hit re-checks the session and the
 * membership, then redirects to a five-minute presigned URL; the bucket
 * itself is never public.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/attachments/[id]'>) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;
  const download = request.nextUrl.searchParams.has('download');
  const url = await resolveDownload(session.user.id, id, { download });
  if (!url) return new Response('Not found', { status: 404 });

  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'private, no-store' },
  });
}
