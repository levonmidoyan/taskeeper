import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { auth } from '@/lib/auth';
import { appUrl } from '@/lib/url';
import { rateLimit } from '@/db';

beforeEach(resetDb);
afterAll(closeDb);

const ip = '203.0.113.7';

function signIn() {
  return auth.handler(
    new Request(`${appUrl()}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl(), 'x-forwarded-for': ip },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    }),
  );
}

// On serverless every instance has its own memory, so an in-memory counter
// resets with each cold start and splits across instances. The counts live in
// the database instead, where every instance sees the same one.
describe('auth rate limit', () => {
  it('records sign-in attempts in the database', async () => {
    await signIn();

    const rows = await db.select().from(rateLimit);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toContain(ip);
    expect(rows[0].count).toBe(1);
  });

  it('enforces a count another instance wrote', async () => {
    await signIn();
    const [row] = await db.select().from(rateLimit);
    await db.update(rateLimit).set({ count: 100 }).where(eq(rateLimit.key, row.key));

    const res = await signIn();
    expect(res.status).toBe(429);
  });
});
