'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import {
  createTodo, deleteTodo, moveTodo, updateTodo,
  type CreateTodoInput, type DeleteTodoInput, type MoveTodoInput, type UpdateTodoInput,
} from './service';

/**
 * Slug-taking wrappers: the workspace and the user both come from the session
 * plus the slug, never from the client. Only the to-do page shows these rows,
 * so revalidation is that one route.
 */

const todoPath = (workspaceSlug: string) => `/${workspaceSlug}/todo`;

export async function createTodoAction(
  workspaceSlug: string,
  input: CreateTodoInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function updateTodoAction(
  workspaceSlug: string,
  input: UpdateTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function moveTodoAction(
  workspaceSlug: string,
  input: MoveTodoInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const result = await moveTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function deleteTodoAction(
  workspaceSlug: string,
  input: DeleteTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}
