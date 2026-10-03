import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, reminder, task } from '@/db';
import { newId } from '@/lib/ids';
import { isReminderOffset, type ReminderOffset } from '@/lib/reminders';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

/** My reminders on one task. Personal: a teammate's are never shown or touched. */
export async function listMyReminders(ctx: WorkspaceContext, taskId: string): Promise<ReminderOffset[]> {
  const rows = await db
    .select({ offsetDays: reminder.offsetDays })
    .from(reminder)
    .where(
      and(
        eq(reminder.taskId, taskId),
        eq(reminder.userId, ctx.userId),
        eq(reminder.workspaceId, ctx.workspaceId),
      ),
    )
    .orderBy(asc(reminder.offsetDays));
  return rows.map((r) => r.offsetDays as ReminderOffset);
}

const setSchema = z.object({
  taskId: z.string().min(1),
  offsets: z.array(z.number().refine(isReminderOffset)).max(4),
});

/** Replaces my set of reminders on a task in one transaction. */
export async function setTaskReminders(
  ctx: WorkspaceContext,
  input: { taskId: string; offsets: number[] },
): Promise<Result<ReminderOffset[]>> {
  return withAction(async () => {
    const parsed = setSchema.safeParse(input);
    if (!parsed.success) return err('Pick from the offered reminder times.');

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const offsets = [...new Set(parsed.data.offsets as ReminderOffset[])].sort((a, b) => a - b);

    await db.transaction(async (tx) => {
      // Two saves at once would both delete, then both insert the same offset
      // and trip the unique index. The lock makes the second wait its turn.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`reminder:${owned.id}:${ctx.userId}`}))`);
      await tx
        .delete(reminder)
        .where(and(eq(reminder.taskId, owned.id), eq(reminder.userId, ctx.userId)));
      if (offsets.length) {
        await tx.insert(reminder).values(
          offsets.map((offsetDays) => ({
            id: newId(), workspaceId: ctx.workspaceId, taskId: owned.id, userId: ctx.userId, offsetDays,
          })),
        );
      }
    });

    return ok(offsets);
  });
}
