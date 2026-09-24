'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createComment, deleteComment, updateComment } from './service';

/**
 * Slug-taking wrappers only (Amendment A): every export here is a public HTTP
 * endpoint, so none of them may accept a caller-supplied WorkspaceContext.
 */

function revalidateWorkspace(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, 'layout');
}

export async function createCommentAction(
  workspaceSlug: string,
  input: { taskId: string; body: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function updateCommentAction(
  workspaceSlug: string,
  input: { commentId: string; body: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function deleteCommentAction(
  workspaceSlug: string,
  input: { commentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
