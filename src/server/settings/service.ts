import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, workspaceSettings } from '@/db';
import { isValidTimezone } from '@/lib/dates';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';
import { emitChange } from '@/server/changes/service';

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

    await db.transaction(async (tx) => {
      await tx
        .update(workspaceSettings).set(patch)
        .where(eq(workspaceSettings.workspaceId, ctx.workspaceId));
      await emitChange(ctx, {}, tx);
    });

    return ok(null);
  });
}
