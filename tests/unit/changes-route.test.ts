import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/changes/queries', () => ({ pollWorkspaceVersion: vi.fn() }));

const { GET } = await import('@/app/api/workspaces/[slug]/changes/route');
const { auth } = await import('@/lib/auth');
const { pollWorkspaceVersion } = await import('@/server/changes/queries');

const getSession = vi.mocked(auth.api.getSession);
const poll = vi.mocked(pollWorkspaceVersion);

afterEach(() => vi.clearAllMocks());

const call = (slug = 'acme') =>
  GET(new Request(`http://localhost/api/workspaces/${slug}/changes`) as never, { params: Promise.resolve({ slug }) });

describe('GET /api/workspaces/[slug]/changes', () => {
  it('401s without a session and reads nothing', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(poll).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('404s for a non-member or unknown slug', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    poll.mockResolvedValue(null);
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(poll).toHaveBeenCalledWith('u1', 'nope');
  });

  it('answers a member with the version, never cached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    poll.mockResolvedValue(7);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 7 });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
