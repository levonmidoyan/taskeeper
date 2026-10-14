import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local' });
process.env.TZ = 'UTC';

if (!process.env.S3_BUCKET_TEST) {
  throw new Error('S3_BUCKET_TEST is not set. Copy the S3_* block from .env.example to .env.local.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    // Phone layout: iPhone 13 viewport and touch on Chromium (the only engine installed).
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'yarn build && yarn start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The e2e run uses the test database, not the development one. It also
    // turns off better-auth's rate limiter, which several sign-ups in a row
    // from one address would otherwise trip, and email verification, which
    // needs an inbox the browser cannot reach.
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST!,
      S3_BUCKET: process.env.S3_BUCKET_TEST,
      TZ: 'UTC',
      AUTH_RATE_LIMIT: 'off',
      AUTH_EMAIL_VERIFICATION: 'off',
      // Invitation emails go to the log, never to a real inbox.
      RESEND_API_KEY: '',
      // Lets reminders.spec.ts trigger the reminders cron like Vercel does.
      CRON_SECRET: 'e2e-cron-secret',
      // Live refresh runs on polling in e2e, never against a real Pusher app.
      PUSHER_APP_ID: '',
      PUSHER_KEY: '',
      PUSHER_SECRET: '',
      PUSHER_CLUSTER: '',
      // Test-only key pair (not used anywhere else). Pushes go to a fake endpoint and fail quietly.
      VAPID_PUBLIC_KEY: 'BLhuermiAhMdo2y0Ecu4whebAI4EcftExqOo1QK2yHbQNv9RssSQl_ArCXUytNkkVpmb2wo79IWoQ1a3EteU_bc',
      VAPID_PRIVATE_KEY: 'p2AULJQIAjkW3FzV5xmPKecYcH2V-IfUOUzaieLdzOI',
      VAPID_SUBJECT: 'mailto:e2e@example.com',
    },
  },
});
