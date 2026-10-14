import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

// One row per browser/device that turned push on. The endpoint is the device's
// address at its push service; it moves with whoever subscribed last there.
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('push_subscription_user_idx').on(t.userId)],
);
