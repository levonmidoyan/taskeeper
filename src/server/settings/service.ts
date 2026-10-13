import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, organization, workspaceSettings } from '@/db';
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

/** A resized avatar is a few KB; the cap keeps a raw photo out of every page load. */
const MAX_LOGO_LENGTH = 100_000;
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Sets or clears the workspace icon. Stored inline as a data URL in
 * better-auth's `organization.logo`, the same way user avatars are; SVG is
 * refused since it can carry script.
 */
export async function updateWorkspaceLogo(ctx: WorkspaceContext, logo: string | null): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = z.string().max(MAX_LOGO_LENGTH).regex(LOGO_PATTERN).nullable().safeParse(logo);
    if (!parsed.success) return err('That image is not valid.');

    await db.transaction(async (tx) => {
      await tx.update(organization).set({ logo: parsed.data }).where(eq(organization.id, ctx.workspaceId));
      await emitChange(ctx, {}, tx);
    });

    return ok(null);
  });
}
