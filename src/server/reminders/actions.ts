'use server';

import { withAction, type Result } from '@/lib/result';
import type { ReminderOffset } from '@/lib/reminders';
import { requireWorkspace } from '@/lib/session';
import { setTaskReminders } from './service';

/**
 * Slug-taking wrapper only: every export here is a public endpoint. No
 * revalidation — reminders are personal and only the task dialog shows them,
 * which keeps its own state.
 */
export async function setTaskRemindersAction(
  workspaceSlug: string,
  input: { taskId: string; offsets: number[] },
): Promise<Result<ReminderOffset[]>> {
  return withAction(async () => setTaskReminders(await requireWorkspace(workspaceSlug), input));
}
