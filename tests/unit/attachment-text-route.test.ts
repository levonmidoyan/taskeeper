import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/attachments/download', () => ({ readTextPreview: vi.fn() }));

const { GET } = await import('@/app/api/attachments/[id]/text/route');
const { auth } = await import('@/lib/auth');
const { readTextPreview } = await import('@/server/attachments/download');

const getSession = vi.mocked(auth.api.getSession);
const read = vi.mocked(readTextPreview);

afterEach(() => vi.clearAllMocks());

const call = (id = 'a1') => {
  const url = `http://localhost/api/attachments/${id}/text`;
  return GET(new Request(url) as never, { params: Promise.resolve({ id }) });
};

describe('GET /api/attachments/[id]/text', () => {
  it('401s without a session and reads nothing', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('404s when the attachment is missing or not visible to the user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    read.mockResolvedValue({ status: 'missing' });
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(read).toHaveBeenCalledWith('u1', 'nope');
  });

  it('415s for a file that is not text', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    read.mockResolvedValue({ status: 'unsupported' });
    expect((await call()).status).toBe(415);
  });

  it('serves the text as plain, unsniffed, uncached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    read.mockResolvedValue({ status: 'ok', text: '<b>hi</b>', truncated: true });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<b>hi</b>');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-preview-truncated')).toBe('1');
  });

  it('marks a whole file as not truncated', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    read.mockResolvedValue({ status: 'ok', text: 'all', truncated: false });
    expect((await call()).headers.get('x-preview-truncated')).toBe('0');
  });
});
