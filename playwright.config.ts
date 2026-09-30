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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
    },
  },
});
