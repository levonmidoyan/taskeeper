'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { settle } from '@/lib/settle';
import { setTaskParentAction } from '@/server/tasks/actions';

/**
 * Convert a task ↔ subtask, then offer Undo, which converts it straight back
 * into the slot it left (not the end of its column or sibling list).
 */
export function useSetParent(workspaceSlug: string) {
  const router = useRouter();

  async function run(taskId: string, parentTaskId: string | null, restoreKey: string | null = null) {
    const result = await settle(setTaskParentAction(workspaceSlug, { taskId, parentTaskId, restoreKey }));
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    router.refresh();
    return result.data;
  }

  return async function setParent(taskId: string, parentTaskId: string | null, undoParentId: string | null, message: string) {
    const done = await run(taskId, parentTaskId);
    if (!done) return;
    toast.success(message, {
      action: { label: 'Undo', onClick: () => void run(taskId, undoParentId, done.previousKey) },
    });
  };
}
