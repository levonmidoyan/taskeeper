'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { err, ok, withAction, type Result } from '@/lib/result';
import { listLabels, listWorkspaceMembers, type MemberRow } from '@/server/labels/queries';
import { getProject, type StatusRow } from '@/server/projects/queries';
import {
  listRecentTasks, searchTasks, type LabelRow, type RecentTask, type TaskSearchHit,
} from './queries';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
  type BulkUpdateTasksInput, type CreateTaskInput, type MoveTaskInput, type UpdateTaskInput,
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
  input: CreateTaskInput,
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

/** Read-only. The palette's empty state: the caller's five latest touched tasks. */
export async function recentTasksAction(workspaceSlug: string): Promise<Result<RecentTask[]>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    return ok(await listRecentTasks(ctx, 5));
  });
}

export type CreateTaskOptions = {
  statuses: StatusRow[];
  members: MemberRow[];
  labels: LabelRow[];
  timezone: string;
};

/**
 * What the create form's fields pick from. Read-only, and fetched per project
 * because the columns belong to the project, not the workspace.
 */
export async function getCreateTaskOptionsAction(
  workspaceSlug: string,
  projectId: string,
): Promise<Result<CreateTaskOptions>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    const [detail, members, labels] = await Promise.all([
      getProject(ctx, projectId), listWorkspaceMembers(ctx), listLabels(ctx),
    ]);
    if (!detail) return err('Project not found.');
    return ok({ statuses: detail.statuses, members, labels, timezone: ctx.timezone });
  });
}
