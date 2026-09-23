'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import {
  createTask, deleteTask, moveTask, updateTask,
  type MoveTaskInput, type UpdateTaskInput,
} from './service';

/**
 * Slug-taking wrappers only (Amendment A): every export here is a public HTTP
 * endpoint, so none of them may accept a caller-supplied WorkspaceContext.
 *
 * Cache invalidation lives here rather than in the service, because
 * revalidatePath needs a request scope — calling it from the context-taking
 * functions throws "static generation store missing" when they are called from
 * a test or a script. 'layout' invalidates the workspace layout, so the rail's
 * project counts and every page nested under it refresh together.
 */

function revalidateWorkspace(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, 'layout');
}

export async function createTaskAction(
  workspaceSlug: string,
  input: { projectId: string; title: string; statusId?: string; parentTaskId?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createTask(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function updateTaskAction(
  workspaceSlug: string,
  input: UpdateTaskInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateTask(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function moveTaskAction(
  workspaceSlug: string,
  input: MoveTaskInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const result = await moveTask(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function deleteTaskAction(
  workspaceSlug: string,
  input: { taskId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteTask(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
