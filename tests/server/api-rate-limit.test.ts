import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { apiUser } from '../setup/api';
import { apiRateLimit } from '@/db';
import { hitRateLimit, pruneRateLimits } from '@/server/api/rate-limit';

beforeEach(resetDb);
afterAll(closeDb);

describe('hitRateLimit', () => {
  it('allows 120 requests in a window and refuses the 121st with seconds to the window end', async () => {
    const { tokenId } = await apiUser('rl1@example.com');
    const now = new Date('2026-10-05T10:00:30.200Z');

    for (let i = 0; i < 120; i += 1) expect(await hitRateLimit(tokenId, now)).toEqual({ ok: true });
    expect(await hitRateLimit(tokenId, now)).toEqual({ ok: false, retryAfter: 30 });
  });

  it('starts counting again in the next window', async () => {
    const { tokenId } = await apiUser('rl2@example.com');
    await db.insert(apiRateLimit).values({ tokenId, windowStart: new Date('2026-10-05T10:00:00Z'), count: 120 });

    expect((await hitRateLimit(tokenId, new Date('2026-10-05T10:00:59Z'))).ok).toBe(false);
    expect(await hitRateLimit(tokenId, new Date('2026-10-05T10:01:00Z'))).toEqual({ ok: true });
  });

  it('counts each token on its own', async () => {
    const a = await apiUser('rl3a@example.com');
    const b = await apiUser('rl3b@example.com');
    const now = new Date('2026-10-05T10:00:00Z');
    await db.insert(apiRateLimit).values({ tokenId: a.tokenId, windowStart: now, count: 120 });

    expect((await hitRateLimit(a.tokenId, now)).ok).toBe(false);
    expect((await hitRateLimit(b.tokenId, now)).ok).toBe(true);
  });
});

describe('pruneRateLimits', () => {
  it('deletes windows that have ended and keeps the current one', async () => {
    const { tokenId } = await apiUser('rl4@example.com');
    await db.insert(apiRateLimit).values([
      { tokenId, windowStart: new Date('2026-10-05T09:58:00Z'), count: 3 },
      { tokenId, windowStart: new Date('2026-10-05T10:00:00Z'), count: 3 },
    ]);

    expect(await pruneRateLimits(new Date('2026-10-05T10:00:10Z'))).toBe(1);
    expect(await db.select().from(apiRateLimit)).toHaveLength(1);
  });
});
