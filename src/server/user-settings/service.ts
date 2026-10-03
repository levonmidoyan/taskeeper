import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, userSettings } from '@/db';
import { isValidTimezone } from '@/lib/dates';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { UserContext } from '@/lib/session';

/** The user's own zone, or null when they follow each workspace's. */
export async function getUserTimezone(ctx: UserContext): Promise<string | null> {
  const [row] = await db
    .select({ timezone: userSettings.timezone })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row?.timezone ?? null;
}

/** Sets the user's own zone; null goes back to following the workspace. */
export async function updateUserTimezone(
  ctx: UserContext,
  timezone: string | null,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z.string().nullable().safeParse(timezone);
    if (!parsed.success) return err('That is not a recognised timezone.');
    if (parsed.data !== null && !isValidTimezone(parsed.data)) {
      return err('That is not a recognised timezone.');
    }

    await db
      .insert(userSettings)
      .values({ userId: ctx.userId, timezone: parsed.data })
      .onConflictDoUpdate({ target: userSettings.userId, set: { timezone: parsed.data } });

    return ok(null);
  });
}
