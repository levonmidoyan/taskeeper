import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.TZ = 'UTC';

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env.local.');
}

// Every module that reads DATABASE_URL gets the test database during tests.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

// Tests must never send real email. Without an SMTP host, invites log their
// link to the console instead (see src/lib/email.tsx).
delete process.env.SMTP_HOST;

// Tests must never publish to a real Pusher app; without these, live refresh
// is polling only (see src/server/changes/pusher.ts).
for (const name of ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER']) {
  delete process.env[name];
}

// Tests must never send real web push; without these, delivery is off (src/server/push/config.ts).
for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  delete process.env[name];
}

if (!process.env.S3_BUCKET_TEST) {
  throw new Error('S3_BUCKET_TEST is not set. Copy the S3_* block from .env.example to .env.local.');
}

// Every module that reads S3_BUCKET gets the test bucket during tests.
process.env.S3_BUCKET = process.env.S3_BUCKET_TEST;
