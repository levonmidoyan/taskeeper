import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { task } from './task';

export const comment = pgTable(
  'comment',
  {
    id: text('id').primaryKey(),
    // Denormalized like task.workspace_id (spec §3.3): the tenancy filter is one
    // predicate, never a join through task -> project.
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull().references(() => user.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Null until the author edits; the UI shows "(edited)" off this, so it is a
    // separate column rather than an updated_at that every write touches.
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('comment_task_created_idx').on(t.taskId, t.createdAt)],
);

export const taskActivity = pgTable(
  'task_activity',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull().references(() => user.id),
    // Plain text, not a pg enum: the kind list is owned by application code and
    // grows with features, and an enum would need a migration for each addition.
    // The reader validates against ACTIVITY_KINDS.
    kind: text('kind').notNull(),
    // Display text as it was at the time — a status name, a member name, a date
    // string — never an id. History must still read correctly after the column
    // or the member it names is gone.
    fromValue: text('from_value'),
    toValue: text('to_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_activity_task_created_idx').on(t.taskId, t.createdAt)],
);
