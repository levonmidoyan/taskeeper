import { lt, sql } from 'drizzle-orm';
import { apiRateLimit, db } from '@/db';
import { API_RATE_LIMIT, API_RATE_WINDOW_SECONDS } from '@/lib/api-tokens';

const WINDOW_MS = API_RATE_WINDOW_SECONDS * 1000;

/**
 * Counts one request against the token's current fixed window, in one
 * upsert-and-return so concurrent requests on different instances agree.
 */
export async function hitRateLimit(
  tokenId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const start = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
  const [row] = await db
    .insert(apiRateLimit)
    .values({ tokenId, windowStart: new Date(start), count: 1 })
    .onConflictDoUpdate({
      target: [apiRateLimit.tokenId, apiRateLimit.windowStart],
      set: { count: sql`${apiRateLimit.count} + 1` },
    })
    .returning({ count: apiRateLimit.count });

  if (row.count <= API_RATE_LIMIT) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((start + WINDOW_MS - now.getTime()) / 1000)) };
}

/** Deletes windows that have ended. Run daily by the reminders cron. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(apiRateLimit)
    .where(lt(apiRateLimit.windowStart, new Date(now.getTime() - WINDOW_MS)))
    .returning({ tokenId: apiRateLimit.tokenId });
  return rows.length;
}
