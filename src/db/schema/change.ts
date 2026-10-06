import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

/**
 * One counter per workspace, bumped by every write to shared data in the same
 * transaction as the write (src/server/changes/service.ts). Open pages poll it
 * and refresh when it moves. No row = version 0.
 */
export const workspaceChange = pgTable('workspace_change', {
  workspaceId: text('workspace_id').primaryKey().references(() => organization.id, { onDelete: 'cascade' }),
  version: bigint('version', { mode: 'number' }).notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});
