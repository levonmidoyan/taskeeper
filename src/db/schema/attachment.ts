import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { task } from './task';

export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'ready']);

export const attachment = pgTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    // Denormalized like comment.workspace_id (spec §3.3): the tenancy filter is
    // one predicate, never a join through task -> project.
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    // Null once the uploader deletes their account; the UI shows "Deleted user".
    uploaderId: text('uploader_id').references(() => user.id, { onDelete: 'set null' }),
    // ws/{workspaceId}/tasks/{taskId}/{id}; the user's file name is never in it.
    key: text('key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    // Pending from the moment an upload URL is issued until the object is
    // checked. Only ready rows are listed or downloadable.
    status: attachmentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachment_task_created_idx').on(t.taskId, t.createdAt)],
);
