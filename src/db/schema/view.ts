import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { project } from './project';

/**
 * A named filter + layout + sort. project_id null = a workspace view (All tasks).
 * `filter` is a TaskFilter (src/lib/task-filter.ts), parsed with Zod on every read
 * and write; it is never interpolated into SQL.
 */
export const savedView = pgTable(
  'saved_view',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shared: boolean('shared').notNull().default(false),
    layout: text('layout').notNull(),
    filter: jsonb('filter').notNull().default(sql`'{}'::jsonb`),
    sort: text('sort'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saved_view_scope_idx').on(t.workspaceId, t.projectId),
    check('saved_view_layout_ck', sql`${t.layout} in ('board', 'list', 'calendar')`),
    check('saved_view_board_project_ck', sql`${t.layout} <> 'board' or ${t.projectId} is not null`),
  ],
);
