import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/changes/queries', () => ({ isWorkspaceMember: vi.fn() }));

const { POST } = await import('@/app/api/pusher/auth/route');
const { auth } = await import('@/lib/auth');
const { isWorkspaceMember } = await import('@/server/changes/queries');
const { parseWorkspaceChannel, workspaceChannel } = await import('@/lib/live/channel');

const getSession = vi.mocked(auth.api.getSession);
const member = vi.mocked(isWorkspaceMember);

const PUSHER_ENV = { PUSHER_APP_ID: '1', PUSHER_KEY: 'key', PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'eu' };

beforeEach(() => Object.assign(process.env, PUSHER_ENV));
afterEach(() => {
  for (const name of Object.keys(PUSHER_ENV)) delete process.env[name];
  vi.clearAllMocks();
});

const call = (socketId = '123.456', channel = 'private-workspace-w1') =>
  POST(
    new Request('http://localhost/api/pusher/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ socket_id: socketId, channel_name: channel }).toString(),
    }),
  );

describe('POST /api/pusher/auth', () => {
  it('404s when Pusher is not configured', async () => {
    delete process.env.PUSHER_KEY;
    const res = await call();
    expect(res.status).toBe(404);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    ['another prefix', '123.456', 'presence-workspace-w1'],
    ['a public channel', '123.456', 'workspace-w1'],
    ['an id with junk', '123.456', 'private-workspace-w1;x'],
    ['an empty id', '123.456', 'private-workspace-'],
    ['a malformed socket id', 'abc', 'private-workspace-w1'],
  ])('403s for %s without reading membership', async (_label, socketId, channel) => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    const res = await call(socketId, channel);
    expect(res.status).toBe(403);
    expect(member).not.toHaveBeenCalled();
  });

  it('403s for a non-member', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    member.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(member).toHaveBeenCalledWith('u1', 'w1');
  });

  it('signs the channel for a member, never cached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    member.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: string };
    expect(body.auth).toMatch(/^key:[0-9a-f]{64}$/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('workspace channel names', () => {
  it('round-trip', () => {
    expect(parseWorkspaceChannel(workspaceChannel('Ab_9-x'))).toBe('Ab_9-x');
  });
});
