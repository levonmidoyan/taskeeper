import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { pollWorkspaceVersion } from '@/server/changes/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The live-refresh poll (src/lib/live/transport.ts): the workspace's change
 * counter, for members only. A non-member and an unknown slug get the same 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401, headers: NO_STORE });

  const { slug } = await params;
  const version = await pollWorkspaceVersion(session.user.id, slug);
  if (version === null) return new Response('Not found', { status: 404, headers: NO_STORE });

  return Response.json({ version }, { headers: NO_STORE });
}
