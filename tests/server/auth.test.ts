import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { auth } from '@/lib/auth';
import { user } from '@/db';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

/** Without a Resend key the verification email is logged; this reads its link back. */
function captureVerificationLinks() {
  const links: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((line: string) => {
    const match = /^\[verify-email\] \S+ -> (\S+)$/.exec(line);
    if (match) links.push(match[1]);
  });
  return links;
}

async function markVerified(email: string) {
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
}

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

  it('does not create a second account for a duplicate email', async () => {
    const body = { name: 'Ada', email: 'dupe@example.com', password: 'correct-horse' };
    await auth.api.signUpEmail({ body });
    // With verification required, better-auth answers a duplicate like a fresh
    // sign-up so the response cannot be used to probe which emails exist.
    await auth.api.signUpEmail({ body });

    expect(await db.select().from(user)).toHaveLength(1);
  });

  it('sends a verification link on sign up and issues no session until it is used', async () => {
    const links = captureVerificationLinks();

    const result = await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'verify@example.com', password: 'correct-horse' },
    });

    expect(result.token).toBeNull();
    expect(links).toHaveLength(1);

    const token = new URL(links[0]).searchParams.get('token')!;
    await auth.api.verifyEmail({ query: { token } });

    const [row] = await db.select().from(user).where(eq(user.email, 'verify@example.com'));
    expect(row.emailVerified).toBe(true);
  });

  it('refuses to sign in an unverified account and resends its link', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'unverified@example.com', password: 'correct-horse' },
    });
    const links = captureVerificationLinks();

    await expect(
      auth.api.signInEmail({ body: { email: 'unverified@example.com', password: 'correct-horse' } }),
    ).rejects.toThrow('Email not verified');
    expect(links).toHaveLength(1);
  });

  it('signs in with the correct password and issues a session', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'signin@example.com', password: 'correct-horse' },
    });
    await markVerified('signin@example.com');

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
