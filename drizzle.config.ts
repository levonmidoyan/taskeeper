import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// db:migrate:prod points this at .env.production.local; everything else uses .env.local.
config({ path: process.env.DRIZZLE_ENV_FILE ?? '.env.local' });

// Migrations issue DDL, which PgBouncer's transaction pooling cannot carry, so they
// run against the direct endpoint when the host exposes a separate one.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
