import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.TZ = 'UTC';

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env.local.');
}

// Every module that reads DATABASE_URL gets the test database during tests.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
