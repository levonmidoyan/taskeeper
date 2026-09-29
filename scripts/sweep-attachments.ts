import { config } from 'dotenv';

config({ path: process.env.SWEEP_ENV_FILE ?? '.env.local' });

/**
 * yarn attachments:sweep [--dry-run]
 * SWEEP_ENV_FILE=.env.production.local yarn attachments:sweep  — against production.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { sweepAttachments } = await import('../src/server/attachments/sweep');
  const { pool } = await import('../src/db');
  const result = await sweepAttachments({ dryRun });
  console.log(`${dryRun ? '[dry run] would remove' : 'removed'} ${result.staleRows} stale uploads, ${result.orphanObjects} objects`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
