import { config } from 'dotenv';

config({ path: process.env.SEED_ENV_FILE ?? '.env.local' });

/**
 * yarn db:seed — creates the super admin from SEED_ADMIN_NAME / SEED_ADMIN_EMAIL /
 * SEED_ADMIN_PASSWORD. Safe to run repeatedly: an existing account with that email
 * is promoted to admin instead of duplicated, and its password is left alone.
 * SEED_ENV_FILE=.env.production.local yarn db:seed  — against production.
 * Prints the admin's id as an AUTH_ADMIN_USER_IDS line to copy into the env file.
 *
 * Writes the rows directly rather than through `auth`, whose module graph pulls in
 * the ESM-only email templates. The shape matches what email sign-up stores: a
 * `credential` account whose accountId is the user id, hashed by Better Auth.
 */
async function main() {
  const name = process.env.SEED_ADMIN_NAME?.trim();
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!name || !email || !password) {
    throw new Error('Set SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.');
  }
  // Same floor as emailAndPassword.minPasswordLength in src/lib/auth.ts.
  if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');

  const { eq } = await import('drizzle-orm');
  const { hashPassword } = await import('better-auth/crypto');
  const { account, db, pool, user } = await import('../src/db');
  const { newId } = await import('../src/lib/ids');

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  let userId: string;
  if (existing) {
    userId = existing.id;
    await db.update(user).set({ role: 'admin', emailVerified: true }).where(eq(user.id, userId));
    console.log(`super admin ready (existing account promoted): ${email}`);
  } else {
    userId = newId();
    const hash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.insert(user).values({ id: userId, name, email, emailVerified: true, role: 'admin' });
      await tx.insert(account).values({
        id: newId(), userId, accountId: userId, providerId: 'credential', password: hash,
      });
    });
    console.log(`super admin created: ${email}`);
  }
  console.log(`AUTH_ADMIN_USER_IDS=${userId}`);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
