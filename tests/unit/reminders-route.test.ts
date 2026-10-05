import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/reminders/run', () => ({
  runReminders: vi.fn(async () => ({ claimed: 1, emailed: 1, failed: 0 })),
}));
vi.mock('@/server/api/rate-limit', () => ({ pruneRateLimits: vi.fn(async () => 0) }));

const { GET } = await import('@/app/api/cron/reminders/route');
const { runReminders } = await import('@/server/reminders/run');
const { pruneRateLimits } = await import('@/server/api/rate-limit');

afterEach(() => { delete process.env.CRON_SECRET; vi.mocked(runReminders).mockClear(); vi.mocked(pruneRateLimits).mockClear(); });

const call = (auth?: string) =>
  GET(new Request('http://localhost/api/cron/reminders', auth ? { headers: { authorization: auth } } : {}) as never);

describe('GET /api/cron/reminders', () => {
  it('401s without the secret and runs nothing', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call();
    expect(res.status).toBe(401);
    expect(runReminders).not.toHaveBeenCalled();
    expect(pruneRateLimits).not.toHaveBeenCalled();
  });

  it('runs the job and returns its counts', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, emailed: 1, failed: 0 });
    expect(pruneRateLimits).toHaveBeenCalledOnce();
  });
});
