import { eq } from 'drizzle-orm';
import { db, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

/** First day of the week for this workspace's calendars (0 = Sunday). */
export async function getWeekStart(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ weekStart: workspaceSettings.weekStart })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, ctx.workspaceId))
    .limit(1);
  return row?.weekStart ?? 1;
}
