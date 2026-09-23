'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import {
  createStatus, deleteStatus, moveStatus, updateStatus,
  type CreateStatusInput, type DeleteStatusInput, type MoveStatusInput, type UpdateStatusInput,
} from './service';

/**
 * Slug-taking wrappers only (Amendment A): the workspace context is derived
 * server-side from the slug plus the caller's session, never accepted from the
 * client. Cache invalidation lives here, because revalidatePath needs a request
 * scope — and it is layout-wide, since the columns drive both the board and the
 * list view as well as every status picker in the task dialog.
 */

export async function createStatusAction(
  workspaceSlug: string,
  input: CreateStatusInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createStatus(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function updateStatusAction(
  workspaceSlug: string,
  input: UpdateStatusInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateStatus(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function moveStatusAction(
  workspaceSlug: string,
  input: MoveStatusInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const result = await moveStatus(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function deleteStatusAction(
  workspaceSlug: string,
  input: DeleteStatusInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteStatus(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
