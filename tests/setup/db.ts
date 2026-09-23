import { sql } from 'drizzle-orm';
import { db, pool } from '@/db';

/**
 * Truncate every application table between tests. RESTART IDENTITY CASCADE in one
 * statement sidesteps foreign-key ordering entirely.
 */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      comment, task_activity,
      task_label, task, task_status, label, project,
      workspace_settings, invitation, member, organization,
      session, account, verification, "user"
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { db };
