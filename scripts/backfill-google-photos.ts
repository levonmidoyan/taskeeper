import { config } from 'dotenv';

config({ path: process.env.BACKFILL_ENV_FILE ?? '.env.local' });

/**
 * yarn auth:backfill-google-photos [--dry-run]
 * BACKFILL_ENV_FILE=.env.production.local yarn auth:backfill-google-photos  — against production.
 *
 * Gives users who linked Google before fillImageFromGoogle existed their Google
 * photo, read from the ID token stored on the account. Users who already have an
 * image are left alone, so it is safe to run repeatedly.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { and, eq, isNotNull, isNull } = await import('drizzle-orm');
  const { account, db, pool, user } = await import('../src/db');
  const { fillImageFromGoogle } = await import('../src/server/account/google-photo');

  const candidates = await db
    .select({ providerId: account.providerId, userId: account.userId, idToken: account.idToken })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, 'google'), isNotNull(account.idToken), isNull(user.image)));

  let filled = 0;
  if (!dryRun) {
    for (const candidate of candidates) {
      if (await fillImageFromGoogle(candidate)) filled++;
    }
  }
  console.log(
    dryRun
      ? `[dry run] ${candidates.length} users without an image have a Google account`
      : `set the Google photo on ${filled} of ${candidates.length} users without an image`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
