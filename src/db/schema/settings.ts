import { pgTable, smallint, text } from 'drizzle-orm/pg-core';
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
export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  timezone: text('timezone'),
});
