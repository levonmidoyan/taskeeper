'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { updateWorkspaceSettings } from './service';

export async function updateWorkspaceSettingsAction(
  workspaceSlug: string,
  input: { timezone?: string; weekStart?: number },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateWorkspaceSettings(await requireWorkspace(workspaceSlug), input);
    // Due-date rendering everywhere depends on this value.
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
