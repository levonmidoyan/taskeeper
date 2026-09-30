import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
// Loads the same env file and picks the same database as `drizzle-kit push`.
import drizzleConfig from '../drizzle.config';

/**
 * Part of yarn db:setup — runs every src/db/sql/*.sql file, in name order,
 * after `drizzle-kit push` has created the tables. Push only manages what the
 * schema declares, so triggers and their functions live here. Each file must
 * be safe to rerun.
 */
async function main() {
  const { url } = (drizzleConfig as { dbCredentials: { url: string } }).dbCredentials;
  const dir = join(__dirname, '../src/db/sql');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(await readFile(join(dir, file), 'utf8'));
      console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
