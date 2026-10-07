import { auth } from '@/lib/auth';
import { parseWorkspaceChannel } from '@/lib/live/channel';
import { pusherServer } from '@/server/changes/pusher';
import { isWorkspaceMember } from '@/server/changes/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const SOCKET_ID = /^\d+\.\d+$/;

/**
 * pusher-js asks here before joining a workspace's private channel
 * (src/lib/live/pusher-transport.ts). Members only; a non-member, an unknown
 * workspace and a channel that is not a workspace channel all get 403.
 */
export async function POST(request: Request) {
  const server = pusherServer();
  if (!server) return new Response('Not found', { status: 404, headers: NO_STORE });

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401, headers: NO_STORE });

  const form = new URLSearchParams(await request.text());
  const socketId = form.get('socket_id') ?? '';
  const channel = form.get('channel_name') ?? '';
  const workspaceId = parseWorkspaceChannel(channel);
  if (!SOCKET_ID.test(socketId) || !workspaceId || !(await isWorkspaceMember(session.user.id, workspaceId))) {
    return new Response('Forbidden', { status: 403, headers: NO_STORE });
  }

  return Response.json(server.authorizeChannel(socketId, channel), { headers: NO_STORE });
}
