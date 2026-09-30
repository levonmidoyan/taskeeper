import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// db:setup:prod points this at .env.production.local; everything else uses .env.local.
config({ path: process.env.DRIZZLE_ENV_FILE ?? '.env.local' });

// v1 has no migrations: `drizzle-kit push` creates the tables straight from the
// schema. db:setup:test targets the test database instead of the dev one.
// Otherwise DDL runs against the direct endpoint when the host exposes one,
// since PgBouncer's transaction pooling cannot carry it.
const url =
  process.env.DRIZZLE_DB === 'test'
    ? process.env.DATABASE_URL_TEST
    : (process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL);
if (!url) throw new Error('DATABASE_URL is not set');

export default defineConfig({
  schema: './src/db/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
});
