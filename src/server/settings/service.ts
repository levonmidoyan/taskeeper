import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, workspaceSettings } from '@/db';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';

/** Asks the runtime whether a zone exists rather than shipping a list that goes stale. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateWorkspaceSettings(
  ctx: WorkspaceContext,
  input: { timezone?: string; weekStart?: number },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = z
      .object({
        timezone: z.string().optional(),
        weekStart: z.number().int().min(0).max(6).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return err('Those settings are not valid.');

    if (parsed.data.timezone && !isValidTimezone(parsed.data.timezone)) {
      return err('That is not a recognised timezone.');
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.timezone) patch.timezone = parsed.data.timezone;
    if (parsed.data.weekStart !== undefined) patch.weekStart = parsed.data.weekStart;
    if (Object.keys(patch).length === 0) return ok(null);

    await db
      .update(workspaceSettings).set(patch)
      .where(eq(workspaceSettings.workspaceId, ctx.workspaceId));

    return ok(null);
  });
}
