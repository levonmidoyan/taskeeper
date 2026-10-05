import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Personal API tokens (REST API v1). Only the SHA-256 of the token is stored;
 * the plaintext exists once, in createApiToken's return value. Signing out or
 * changing the password does not touch these; only revoking or expiry does.
 */
export const apiToken = pgTable(
  'api_token',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // First 8 characters of the token ("tk_aB3xY"), for telling tokens apart.
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    // Null = never expires.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_token_user_idx').on(t.userId)],
);

/**
 * Fixed-window request counts per token. In Postgres because serverless
 * instances share no memory. Old windows are deleted by the reminders cron.
 */
export const apiRateLimit = pgTable(
  'api_rate_limit',
  {
    tokenId: text('token_id').notNull().references(() => apiToken.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.windowStart] })],
);
