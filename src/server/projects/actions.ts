'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import {
  archiveProject, createProject, deleteProject, renameProject, setProjectColor, setProjectStar,
  unarchiveProject,
} from './service';

/**
 * Every export here is a public HTTP endpoint. None of them accept a
 * WorkspaceContext from the caller — each derives it server-side from the
 * workspace slug in the URL plus the caller's own session, via
 * requireWorkspace. Accepting a caller-supplied ctx (workspaceId + role)
 * would let any authenticated client forge membership in, or a role within,
 * a workspace it does not belong to.
 */

export async function createProjectAction(
  workspaceSlug: string,
  input: { name: string; color?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createProject(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function renameProjectAction(
  workspaceSlug: string,
  input: { projectId: string; name: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await renameProject(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function setProjectColorAction(
  workspaceSlug: string,
  input: { projectId: string; color: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await setProjectColor(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

/**
 * `leaving`: the caller is on the project's own page and navigates away once this
 * returns. Revalidating here would re-render that page in the same response, and
 * it now 404s, so the caller refreshes after it has left instead.
 */
type LeaveOptions = { leaving?: boolean };

export async function archiveProjectAction(
  workspaceSlug: string,
  input: { projectId: string },
  options: LeaveOptions = {},
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await archiveProject(await requireWorkspace(workspaceSlug), input);
    if (result.ok && options?.leaving !== true) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function unarchiveProjectAction(
  workspaceSlug: string,
  input: { projectId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await unarchiveProject(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function deleteProjectAction(
  workspaceSlug: string,
  input: { projectId: string },
  options: LeaveOptions = {},
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteProject(await requireWorkspace(workspaceSlug), input);
    if (result.ok && options?.leaving !== true) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function setProjectStarAction(
  workspaceSlug: string,
  input: { projectId: string; starred: boolean },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await setProjectStar(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
