import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { auth } from '@/lib/auth';
import { user } from '@/db';

beforeEach(resetDb);
afterAll(closeDb);

describe('auth', () => {
  it('creates a user on sign up', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse' },
    });

    const rows = await db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('ada@example.com');
  });

  it('rejects a password below the minimum length', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Ada', email: 'short@example.com', password: 'abc' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate email', async () => {
    const body = { name: 'Ada', email: 'dupe@example.com', password: 'correct-horse' };
    await auth.api.signUpEmail({ body });
    await expect(auth.api.signUpEmail({ body })).rejects.toThrow();
  });

  it('signs in with the correct password and issues a session', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'signin@example.com', password: 'correct-horse' },
    });

    const result = await auth.api.signInEmail({
      body: { email: 'signin@example.com', password: 'correct-horse' },
    });

    expect(result.user.email).toBe('signin@example.com');
    expect(result.token).toBeTruthy();
  });

  it('refuses the wrong password', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'wrong@example.com', password: 'correct-horse' },
    });

    await expect(
      auth.api.signInEmail({ body: { email: 'wrong@example.com', password: 'wrong-pass' } }),
    ).rejects.toThrow();
  });
});
