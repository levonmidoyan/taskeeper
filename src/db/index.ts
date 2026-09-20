import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// One code path for every host. Against a pooled provider endpoint this pool sits
// in front of PgBouncer; on a long-running server it is an ordinary pool.
// Never a provider-specific driver (spec §7).
const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export const db = drizzle(pool, { schema });
export { pool };
export * from './schema';
