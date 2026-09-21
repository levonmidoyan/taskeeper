'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createLabel, deleteLabel, setTaskLabels } from './service';
import type { LabelRow } from '@/server/tasks/queries';

/**
 * Slug-taking wrappers only (Amendment A). Cache invalidation lives here rather
 * than in the service, because revalidatePath needs a request scope.
 */

export async function createLabelAction(
  workspaceSlug: string,
  input: { name: string },
): Promise<Result<LabelRow>> {
  return withAction(async () => {
    const result = await createLabel(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function setTaskLabelsAction(
  workspaceSlug: string,
  input: { taskId: string; labelIds: string[] },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await setTaskLabels(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function deleteLabelAction(
  workspaceSlug: string,
  input: { labelId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteLabel(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
