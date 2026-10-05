import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser } from '../setup/factories';
import { apiToken, user } from '@/db';
import {
  authenticateApiToken, createApiToken, listApiTokens, revokeApiToken,
} from '@/server/api-tokens/service';

beforeEach(resetDb);
afterAll(closeDb);

const DAY = 86_400_000;

async function make(userId: string, name = 'CI', expiresInDays: 30 | 90 | 365 | null = 90, now?: Date) {
  const created = await createApiToken({ userId }, { name, expiresInDays }, now);
  if (!created.ok) throw new Error(created.error);
  return created.data;
}

describe('createApiToken', () => {
  it('returns the plaintext once and stores only its hash', async () => {
    const ada = await createUser('t1@example.com');
    const { id, token } = await make(ada.id);

    expect(token).toMatch(/^tk_[0-9A-Za-z]{43}$/);
    const [row] = await db.select().from(apiToken).where(eq(apiToken.id, id));
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.prefix).toBe(token.slice(0, 8));
    expect(Object.values(row)).not.toContain(token);
  });

  it('sets the expiry from the chosen days, or none', async () => {
    const ada = await createUser('t2@example.com');
    const now = new Date('2026-10-05T12:00:00Z');
    const a = await make(ada.id, 'A', 30, now);
    const b = await make(ada.id, 'B', null, now);

    const rows = await db.select().from(apiToken);
    expect(rows.find((r) => r.id === a.id)!.expiresAt).toEqual(new Date(now.getTime() + 30 * DAY));
    expect(rows.find((r) => r.id === b.id)!.expiresAt).toBeNull();
  });

  it('rejects an empty or overlong name and an unknown expiry', async () => {
    const ada = await createUser('t3@example.com');
    expect(await createApiToken({ userId: ada.id }, { name: '  ', expiresInDays: 90 })).toEqual({ ok: false, error: 'Give the token a name.' });
    expect((await createApiToken({ userId: ada.id }, { name: 'x'.repeat(61), expiresInDays: 90 })).ok).toBe(false);
    expect((await createApiToken({ userId: ada.id }, { name: 'X', expiresInDays: 7 as never })).ok).toBe(false);
    expect(await db.select().from(apiToken)).toHaveLength(0);
  });

  it('caps active tokens at 20; revoked and expired ones do not count', async () => {
    const ada = await createUser('t4@example.com');
    const past = new Date(Date.now() - 40 * DAY);
    await make(ada.id, 'old', 30, past); // expired
    const revoked = await make(ada.id, 'gone');
    await revokeApiToken({ userId: ada.id }, revoked.id);
    for (let i = 0; i < 20; i += 1) await make(ada.id, `t${i}`);

    const over = await createApiToken({ userId: ada.id }, { name: 'one more', expiresInDays: 90 });

    expect(over).toEqual({ ok: false, error: 'You can have at most 20 active tokens. Revoke one first.' });
  });
});

describe('listApiTokens', () => {
  it('lists own unrevoked tokens newest first, flagging expired ones', async () => {
    const ada = await createUser('t5@example.com');
    const bob = await createUser('t5b@example.com');
    await make(ada.id, 'old', 30, new Date(Date.now() - 40 * DAY));
    await make(ada.id, 'new');
    const gone = await make(ada.id, 'gone');
    await revokeApiToken({ userId: ada.id }, gone.id);
    await make(bob.id, 'bobs');

    const rows = await listApiTokens({ userId: ada.id });

    expect(rows.map((r) => [r.name, r.expired])).toEqual([['new', false], ['old', true]]);
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'expired', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix']);
  });
});

describe('revokeApiToken', () => {
  it('revokes own token; another user\'s token is not found', async () => {
    const ada = await createUser('t6@example.com');
    const bob = await createUser('t6b@example.com');
    const mine = await make(ada.id);

    expect(await revokeApiToken({ userId: bob.id }, mine.id)).toEqual({ ok: false, error: 'Token not found.', code: 'not_found' });
    expect(await revokeApiToken({ userId: ada.id }, mine.id)).toEqual({ ok: true, data: null });
    expect(await revokeApiToken({ userId: ada.id }, mine.id)).toEqual({ ok: false, error: 'Token not found.', code: 'not_found' });
  });
});

describe('authenticateApiToken', () => {
  it('returns the owner for a live token', async () => {
    const ada = await createUser('t7@example.com');
    const { id, token } = await make(ada.id);
    expect(await authenticateApiToken(token)).toEqual({ userId: ada.id, tokenId: id });
  });

  it('rejects malformed, unknown, revoked and expired tokens alike', async () => {
    const ada = await createUser('t8@example.com');
    const revoked = await make(ada.id, 'r');
    await revokeApiToken({ userId: ada.id }, revoked.id);
    const expired = await make(ada.id, 'e', 30, new Date(Date.now() - 31 * DAY));

    for (const raw of ['', 'nope', 'tk_short', `tk_${'A'.repeat(43)}`, revoked.token, expired.token]) {
      expect(await authenticateApiToken(raw)).toBeNull();
    }
  });

  it('rejects the token of a banned user', async () => {
    const ada = await createUser('t9@example.com');
    const { token } = await make(ada.id);
    await db.update(user).set({ banned: true }).where(eq(user.id, ada.id));
    expect(await authenticateApiToken(token)).toBeNull();

    await db.update(user).set({ banExpires: new Date(Date.now() - DAY) }).where(eq(user.id, ada.id));
    expect(await authenticateApiToken(token)).not.toBeNull();
  });

  it('writes last_used_at at most once a minute', async () => {
    const ada = await createUser('t10@example.com');
    const { id, token } = await make(ada.id);
    const t0 = new Date('2026-10-05T10:00:00Z');
    const lastUsed = async () => (await db.select().from(apiToken).where(eq(apiToken.id, id)))[0].lastUsedAt;

    await authenticateApiToken(token, t0);
    expect(await lastUsed()).toEqual(t0);
    await authenticateApiToken(token, new Date(t0.getTime() + 30_000));
    expect(await lastUsed()).toEqual(t0);
    const t2 = new Date(t0.getTime() + 61_000);
    await authenticateApiToken(token, t2);
    expect(await lastUsed()).toEqual(t2);
  });

  it('goes away with the account', async () => {
    const ada = await createUser('t11@example.com');
    await make(ada.id);
    await db.delete(user).where(eq(user.id, ada.id));
    expect(await db.select().from(apiToken)).toHaveLength(0);
  });
});
