import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
    // Null once the creator deletes their account.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_workspace_slug_uq').on(t.workspaceId, t.slug),
    index('project_workspace_archived_idx').on(t.workspaceId, t.archivedAt),
  ],
);

/**
 * A member's starred projects, shown in their rail. Per user and per project, so
 * teammates each keep their own list. workspace_id is denormalized like task's:
 * the tenancy filter stays one predicate.
 */
export const projectStar = pgTable(
  'project_star',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index('project_star_user_workspace_idx').on(t.userId, t.workspaceId),
  ],
);
