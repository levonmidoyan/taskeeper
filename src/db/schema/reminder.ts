import { sql } from 'drizzle-orm';
import {
  check, index, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { NotificationData } from '@/lib/reminders';
import { organization, user } from './auth';
import { task } from './task';

// A personal reminder: the user who set it is the one told (spec: Per-task reminders).
export const reminder = pgTable(
  'reminder',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    offsetDays: smallint('offset_days').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reminder_task_user_offset_uq').on(t.taskId, t.userId, t.offsetDays),
    check('reminder_offset_days_ck', sql`${t.offsetDays} in (0, 1, 2, 7)`),
  ],
);

export const notificationKind = pgEnum('notification_kind', ['digest', 'reminder']);

// One bell item, and the cron's idempotency claim: dedupe_key is unique, so a
// second run inserting the same key does nothing.
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull().unique(),
    // Display snapshot, so a later rename does not rewrite history and the bell needs no join.
    data: jsonb('data').$type<NotificationData>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailClaimedAt: timestamp('email_claimed_at', { withTimezone: true }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailAttempts: smallint('email_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_bell_idx').on(t.userId, t.workspaceId, t.createdAt),
    index('notification_unsent_idx').on(t.createdAt).where(sql`${t.emailSentAt} is null`),
  ],
);
