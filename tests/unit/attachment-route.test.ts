import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/attachments/download', () => ({ resolveDownload: vi.fn() }));

const { GET } = await import('@/app/api/attachments/[id]/route');
const { auth } = await import('@/lib/auth');
const { resolveDownload } = await import('@/server/attachments/download');

const getSession = vi.mocked(auth.api.getSession);
const resolve = vi.mocked(resolveDownload);

afterEach(() => vi.clearAllMocks());

const call = (id = 'a1', query = '') => {
  const url = `http://localhost/api/attachments/${id}${query}`;
  const request = Object.assign(new Request(url), { nextUrl: new URL(url) });
  return GET(request as never, { params: Promise.resolve({ id }) });
};

describe('GET /api/attachments/[id]', () => {
  it('401s without a session and resolves nothing', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('404s when the attachment is missing or not visible to the user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    resolve.mockResolvedValue(null);
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(resolve).toHaveBeenCalledWith('u1', 'nope', { download: false });
  });

  it('redirects a member to the presigned URL, never cached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    resolve.mockResolvedValue('https://bucket.example/signed');
    const res = await call('a1', '?download=1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://bucket.example/signed');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(resolve).toHaveBeenCalledWith('u1', 'a1', { download: true });
  });
});
