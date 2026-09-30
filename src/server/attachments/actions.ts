'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import type { AttachmentView } from './queries';
import { cancelUpload, confirmUpload, deleteAttachment, requestUpload } from './service';

/**
 * Slug-taking wrappers only (Amendment A): every export here is a public HTTP
 * endpoint, so none of them may accept a caller-supplied WorkspaceContext.
 */

function revalidateWorkspace(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, 'layout');
}

export async function requestUploadAction(
  workspaceSlug: string,
  input: { taskId: string; fileName: string; contentType: string; size: number },
): Promise<Result<{ id: string; url: string; contentType: string }>> {
  return withAction(async () => requestUpload(await requireWorkspace(workspaceSlug), input));
}

export async function confirmUploadAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<AttachmentView>> {
  return withAction(async () => {
    const result = await confirmUpload(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function cancelUploadAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => cancelUpload(await requireWorkspace(workspaceSlug), input));
}

export async function deleteAttachmentAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteAttachment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
