'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createView, deleteView, duplicateView, updateView } from './service';

/**
 * Public HTTP endpoints. The workspace and the owner come from the URL slug and
 * the session (requireWorkspace), never from the caller. Both the rail and the
 * project tabs read views, so every change revalidates the workspace layout.
 */

export async function createViewAction(
  workspaceSlug: string,
  input: Parameters<typeof createView>[1],
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function updateViewAction(
  workspaceSlug: string,
  input: Parameters<typeof updateView>[1],
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function duplicateViewAction(
  workspaceSlug: string,
  input: Parameters<typeof duplicateView>[1],
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await duplicateView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function deleteViewAction(
  workspaceSlug: string,
  input: Parameters<typeof deleteView>[1],
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
