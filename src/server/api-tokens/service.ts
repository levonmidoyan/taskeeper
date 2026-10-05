import { and, count, desc, eq, gt, isNull, lt, not, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiToken, db, user } from '@/db';
import { API_TOKEN_EXPIRY_DAYS, API_TOKEN_NAME_MAX, MAX_ACTIVE_API_TOKENS } from '@/lib/api-tokens';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { UserContext } from '@/lib/session';
import { generateApiToken, hashApiToken, isApiTokenShape, tokenPrefix } from './token';

const DAY_MS = 86_400_000;
const LAST_USED_EVERY_MS = 60_000;

export type ApiTokenRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  expired: boolean;
};

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the token a name.').max(API_TOKEN_NAME_MAX, `Keep the name to ${API_TOKEN_NAME_MAX} characters.`),
  expiresInDays: z.literal([...API_TOKEN_EXPIRY_DAYS], 'Pick one of the offered expiry options.').nullable(),
});

export type CreateApiTokenInput = z.input<typeof createSchema>;

/** Not revoked and not past its expiry. */
function isActive(now: Date) {
  return and(isNull(apiToken.revokedAt), or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)));
}

/** The caller's tokens, newest first. Revoked ones are gone; expired ones stay, flagged. */
export async function listApiTokens(ctx: UserContext, now: Date = new Date()): Promise<ApiTokenRow[]> {
  const rows = await db
    .select({
      id: apiToken.id, name: apiToken.name, prefix: apiToken.prefix, createdAt: apiToken.createdAt,
      lastUsedAt: apiToken.lastUsedAt, expiresAt: apiToken.expiresAt,
    })
    .from(apiToken)
    .where(and(eq(apiToken.userId, ctx.userId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.createdAt), desc(apiToken.id));
  return rows.map((r) => ({ ...r, expired: r.expiresAt !== null && r.expiresAt <= now }));
}

/** The only place the plaintext token exists. */
export async function createApiToken(
  ctx: UserContext,
  input: CreateApiTokenInput,
  now: Date = new Date(),
): Promise<Result<{ id: string; token: string }>> {
  return withAction(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    return db.transaction(async (tx) => {
      // Serialises one user's creates, so two at once cannot both slip under the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`api_token:${ctx.userId}`}))`);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(apiToken)
        .where(and(eq(apiToken.userId, ctx.userId), isActive(now)));
      if (n >= MAX_ACTIVE_API_TOKENS) {
        return err(`You can have at most ${MAX_ACTIVE_API_TOKENS} active tokens. Revoke one first.`);
      }

      const id = newId();
      const token = generateApiToken();
      const days = parsed.data.expiresInDays;
      await tx.insert(apiToken).values({
        id,
        userId: ctx.userId,
        name: parsed.data.name,
        prefix: tokenPrefix(token),
        tokenHash: hashApiToken(token),
        expiresAt: days === null ? null : new Date(now.getTime() + days * DAY_MS),
        createdAt: now,
      });
      return ok({ id, token });
    });
  });
}

export async function revokeApiToken(ctx: UserContext, id: string): Promise<Result<null>> {
  return withAction(async () => {
    const rows = await db
      .update(apiToken)
      .set({ revokedAt: new Date() })
      // Scoped to the caller: someone else's token id is simply not found.
      .where(and(eq(apiToken.id, id), eq(apiToken.userId, ctx.userId), isNull(apiToken.revokedAt)))
      .returning({ id: apiToken.id });
    return rows.length > 0 ? ok(null) : err('Token not found.', 'not_found');
  });
}

/**
 * Not ctx-first: this is what produces the user. Null for a malformed, unknown,
 * revoked or expired token, or a banned owner, without saying which.
 */
export async function authenticateApiToken(
  raw: string,
  now: Date = new Date(),
): Promise<{ userId: string; tokenId: string } | null> {
  if (!isApiTokenShape(raw)) return null;

  // user.banned is nullable; coalesce so a null does not turn the NOT into null.
  const banned = and(
    sql`coalesce(${user.banned}, false)`,
    or(isNull(user.banExpires), gt(user.banExpires, now)),
  )!;
  const [row] = await db
    .select({ tokenId: apiToken.id, userId: apiToken.userId })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    // Better Auth refuses a banned user's sessions; their tokens must not be a way round it.
    .where(and(eq(apiToken.tokenHash, hashApiToken(raw)), isActive(now), not(banned)))
    .limit(1);
  if (!row) return null;

  // At most one write a minute, so a busy script does not write on every request.
  await db
    .update(apiToken)
    .set({ lastUsedAt: now })
    .where(and(
      eq(apiToken.id, row.tokenId),
      or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, new Date(now.getTime() - LAST_USED_EVERY_MS))),
    ));

  return row;
}
