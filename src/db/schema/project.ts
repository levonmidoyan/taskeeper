import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull().default('primary'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_workspace_slug_uq').on(t.workspaceId, t.slug),
    index('project_workspace_archived_idx').on(t.workspaceId, t.archivedAt),
  ],
);
