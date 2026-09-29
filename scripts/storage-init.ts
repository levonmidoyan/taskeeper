import { config } from 'dotenv';

config({ path: '.env.local' });

/** Creates the dev and test buckets on the local MinIO. Safe to run repeatedly. */
async function main() {
  const { ensureBucket } = await import('../src/lib/storage');
  for (const bucket of [process.env.S3_BUCKET, process.env.S3_BUCKET_TEST]) {
    if (!bucket) continue;
    await ensureBucket(bucket);
    console.log(`bucket ready: ${bucket}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
