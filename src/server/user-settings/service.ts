import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, userSettings } from '@/db';
import { isValidTimezone } from '@/lib/dates';
import { DEFAULT_REMINDER_HOUR } from '@/lib/reminders';
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

export type ReminderPrefs = { reminderHour: number; digestEnabled: boolean };

const reminderPrefsSchema = z.object({
  reminderHour: z.number().int().min(0).max(23),
  digestEnabled: z.boolean(),
});

/** When reminders and the digest go out, in the user's local time. */
export async function getReminderPrefs(ctx: UserContext): Promise<ReminderPrefs> {
  const [row] = await db
    .select({ reminderHour: userSettings.reminderHour, digestEnabled: userSettings.digestEnabled })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row ?? { reminderHour: DEFAULT_REMINDER_HOUR, digestEnabled: true };
}

export async function updateReminderPrefs(
  ctx: UserContext,
  input: ReminderPrefs,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = reminderPrefsSchema.safeParse(input);
    if (!parsed.success) return err('Pick an hour between 00:00 and 23:00.');

    await db
      .insert(userSettings)
      .values({ userId: ctx.userId, ...parsed.data })
      .onConflictDoUpdate({ target: userSettings.userId, set: parsed.data });

    return ok(null);
  });
}
