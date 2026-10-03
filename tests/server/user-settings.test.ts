import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser } from '../setup/factories';
import { user, userSettings } from '@/db';
import { getUserTimezone, updateUserTimezone } from '@/server/user-settings/service';

beforeEach(resetDb);
afterAll(closeDb);

describe('user timezone', () => {
  it('is null until the user sets one', async () => {
    const ada = await createUser('ada-pref@example.com');
    expect(await getUserTimezone({ userId: ada.id })).toBeNull();
  });

  it('stores a zone and reads it back', async () => {
    const ada = await createUser('ada-set@example.com');

    const result = await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    expect(result.ok).toBe(true);
    expect(await getUserTimezone({ userId: ada.id })).toBe('Europe/Berlin');
  });

  it('replaces an earlier zone rather than adding a second row', async () => {
    const ada = await createUser('ada-replace@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    await updateUserTimezone({ userId: ada.id }, 'Asia/Tokyo');

    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, ada.id));
    expect(rows).toEqual([{ userId: ada.id, timezone: 'Asia/Tokyo' }]);
  });

  it('null clears the override so the user follows the workspace again', async () => {
    const ada = await createUser('ada-clear@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    const result = await updateUserTimezone({ userId: ada.id }, null);

    expect(result.ok).toBe(true);
    expect(await getUserTimezone({ userId: ada.id })).toBeNull();
  });

  it.each(['Mars/Olympus', ''])('rejects %j and writes nothing', async (zone) => {
    const ada = await createUser(`ada-bad-${zone.length}@example.com`);

    const result = await updateUserTimezone({ userId: ada.id }, zone);

    expect(result).toEqual({ ok: false, error: 'That is not a recognised timezone.' });
    expect(await db.select().from(userSettings)).toEqual([]);
  });

  it('goes away with the user', async () => {
    const ada = await createUser('ada-gone@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    await db.delete(user).where(eq(user.id, ada.id));

    expect(await db.select().from(userSettings)).toEqual([]);
  });
});
