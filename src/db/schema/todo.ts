import { date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

/**
 * A member's personal checklist, one list per workspace. Private by
 * construction: nothing links it to tasks, and every read and write filters on
 * user_id and workspace_id together, so no role — owner and admin included —
 * reaches another member's items.
 */
export const todo = pgTable(
  'todo',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // A calendar day in the workspace zone, like task.due_date — never an instant.
    dueDate: date('due_date'),
    position: text('position').notNull(),
    // Set means done. Done items sort by it, newest first.
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('todo_user_workspace_position_idx').on(t.userId, t.workspaceId, t.position)],
);
