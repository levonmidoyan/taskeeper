'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { ok, withAction, type Result } from '@/lib/result';
import { searchTasks, type TaskSearchHit } from './queries';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
  type BulkUpdateTasksInput, type MoveTaskInput, type UpdateTaskInput,
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

export async function bulkUpdateTasksAction(
  workspaceSlug: string,
  input: BulkUpdateTasksInput,
): Promise<Result<{ updated: number }>> {
  return withAction(async () => {
    const result = await bulkUpdateTasks(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function bulkDeleteTasksAction(
  workspaceSlug: string,
  input: { taskIds: string[] },
): Promise<Result<{ deleted: number }>> {
  return withAction(async () => {
    const result = await bulkDeleteTasks(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

/** Read-only, so nothing to revalidate. Terms under two characters match too much to be useful. */
export async function searchTasksAction(
  workspaceSlug: string,
  term: string,
): Promise<Result<TaskSearchHit[]>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    const trimmed = term.trim().slice(0, 100);
    if (trimmed.length < 2) return ok([]);
    return ok(await searchTasks(ctx, trimmed));
  });
}
