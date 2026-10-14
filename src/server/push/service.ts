import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, pushSubscription, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import { PUSH_DEFAULTS, type PushPrefs } from '@/lib/push';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { UserContext } from '@/lib/session';

// PushSubscription.toJSON(); expirationTime is ignored (browsers send null).
const subscriptionSchema = z.object({
  endpoint: z.url().startsWith('https://').max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

/**
 * Saves this browser's push address for the caller. Upsert on the endpoint, moving it
 * to the caller: the endpoint belongs to the browser, so whoever subscribed there last
 * gets its pushes, never the person who used it before.
 */
export async function subscribePush(ctx: UserContext, input: unknown, userAgent: string | null): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return err('This browser sent an invalid push subscription.');
    const { endpoint, keys } = parsed.data;
    const values = { userId: ctx.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent?.slice(0, 512) ?? null };
    await db
      .insert(pushSubscription)
      .values({ id: newId(), endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { ...values, createdAt: new Date(), lastUsedAt: null } });
    return ok(null);
  });
}

/** Forgets this browser, only when it is the caller's: another user's endpoint is left alone. */
export async function unsubscribePush(ctx: UserContext, endpoint: string): Promise<Result<null>> {
  return withAction(async () => {
    if (typeof endpoint !== 'string') return err('Missing endpoint.');
    await db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, ctx.userId)));
    return ok(null);
  });
}

export async function getPushPrefs(ctx: UserContext): Promise<PushPrefs> {
  const [row] = await db
    .select({
      reminders: userSettings.pushReminders,
      mentions: userSettings.pushMentions,
      taskChanges: userSettings.pushTaskChanges,
      projectChanges: userSettings.pushProjectChanges,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row ?? PUSH_DEFAULTS;
}

const prefsSchema = z.object({
  reminders: z.boolean(), mentions: z.boolean(), taskChanges: z.boolean(), projectChanges: z.boolean(),
});

export async function updatePushPrefs(ctx: UserContext, input: PushPrefs): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = prefsSchema.safeParse(input);
    if (!parsed.success) return err('Invalid push settings.');
    const set = {
      pushReminders: parsed.data.reminders,
      pushMentions: parsed.data.mentions,
      pushTaskChanges: parsed.data.taskChanges,
      pushProjectChanges: parsed.data.projectChanges,
    };
    await db.insert(userSettings).values({ userId: ctx.userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
    return ok(null);
  });
}
