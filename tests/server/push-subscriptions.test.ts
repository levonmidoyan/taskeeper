import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser } from '../setup/factories';
import { pushSubscription } from '@/db';
import type { UserContext } from '@/lib/session';
import { getPushPrefs, subscribePush, unsubscribePush, updatePushPrefs } from '@/server/push/service';

beforeEach(resetDb);
afterAll(closeDb);

const sub = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({
  endpoint, expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
});

async function users() {
  const ada = await createUser('push-ada@example.com', 'Ada');
  const bob = await createUser('push-bob@example.com', 'Bob');
  return { ada: { userId: ada.id } as UserContext, bob: { userId: bob.id } as UserContext };
}

describe('subscribePush', () => {
  it('stores one row per endpoint', async () => {
    const { ada } = await users();
    expect((await subscribePush(ada, sub(), 'iPhone')).ok).toBe(true);
    expect((await subscribePush(ada, sub(), 'iPhone')).ok).toBe(true);
    const rows = await db.select().from(pushSubscription);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ada.userId, userAgent: 'iPhone' });
  });

  it('moves an endpoint to whoever subscribed last on that browser', async () => {
    const { ada, bob } = await users();
    await subscribePush(ada, sub(), null);
    await subscribePush(bob, sub(), null);
    const rows = await db.select().from(pushSubscription);
    expect(rows.map((r) => r.userId)).toEqual([bob.userId]);
  });

  it('rejects a non-https endpoint or missing keys', async () => {
    const { ada } = await users();
    expect((await subscribePush(ada, { ...sub(), endpoint: 'http://x.test' }, null)).ok).toBe(false);
    expect((await subscribePush(ada, { endpoint: 'https://x.test' }, null)).ok).toBe(false);
  });

  it('only accepts known browser push services, so the server never posts to an arbitrary host', async () => {
    const { ada } = await users();
    for (const endpoint of ['https://169.254.169.254/latest', 'https://internal.example.com/x', 'https://fcm.googleapis.com.evil.test/x']) {
      expect((await subscribePush(ada, sub(endpoint), null)).ok).toBe(false);
    }
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) {
      expect((await subscribePush(ada, sub(endpoint), null)).ok).toBe(true);
    }
  });
});

describe('unsubscribePush', () => {
  it('deletes only the caller’s own endpoint', async () => {
    const { ada, bob } = await users();
    await subscribePush(ada, sub(), null);
    await unsubscribePush(bob, sub().endpoint);
    expect(await db.select().from(pushSubscription)).toHaveLength(1);
    await unsubscribePush(ada, sub().endpoint);
    expect(await db.select().from(pushSubscription)).toHaveLength(0);
  });
});

describe('push prefs', () => {
  it('returns defaults without a settings row, then what was saved', async () => {
    const { ada } = await users();
    expect(await getPushPrefs(ada)).toEqual({ reminders: true, mentions: true, taskChanges: true, projectChanges: false });
    const saved = { reminders: false, mentions: true, taskChanges: false, projectChanges: true };
    expect((await updatePushPrefs(ada, saved)).ok).toBe(true);
    expect(await getPushPrefs(ada)).toEqual(saved);
  });

  it('rejects non-boolean prefs', async () => {
    const { ada } = await users();
    const bad = { reminders: 'yes' } as unknown as Parameters<typeof updatePushPrefs>[1];
    expect((await updatePushPrefs(ada, bad)).ok).toBe(false);
  });
});

it('cascades with the user', async () => {
  const { ada } = await users();
  await subscribePush(ada, sub(), null);
  await db.execute(sql`delete from "user" where id = ${ada.userId}`);
  expect(await db.select().from(pushSubscription).where(eq(pushSubscription.userId, ada.userId))).toHaveLength(0);
});
