'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { updateWorkspaceLogo, updateWorkspaceSettings } from './service';

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

export async function updateWorkspaceLogoAction(workspaceSlug: string, logo: string | null): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateWorkspaceLogo(await requireWorkspace(workspaceSlug), logo);
    // The switcher in every page's rail shows it.
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
