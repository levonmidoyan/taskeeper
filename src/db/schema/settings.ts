import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

// Separate from `organization` because better-auth owns that table (spec §3.1).
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Asia/Yerevan'),
  weekStart: smallint('week_start').notNull().default(1),
});

// Per-user preferences that are not workspace-scoped. A null timezone means
// "follow each workspace's zone"; resolveWorkspace applies the fallback.
export const userSettings = pgTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone'),
    // Local hour (0–23) for the daily digest and per-task reminders.
    reminderHour: smallint('reminder_hour').notNull().default(9),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
  },
  (t) => [check('user_settings_reminder_hour_ck', sql`${t.reminderHour} between 0 and 23`)],
);
