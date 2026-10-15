'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { settle } from '@/lib/settle';
import { setTaskParentAction } from '@/server/tasks/actions';

/** Convert a task ↔ subtask, then offer Undo, which converts it straight back. */
export function useSetParent(workspaceSlug: string) {
  const router = useRouter();

  async function run(taskId: string, parentTaskId: string | null): Promise<boolean> {
    const result = await settle(setTaskParentAction(workspaceSlug, { taskId, parentTaskId }));
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return async function setParent(taskId: string, parentTaskId: string | null, undoParentId: string | null, message: string) {
    if (!(await run(taskId, parentTaskId))) return;
    toast.success(message, {
      action: { label: 'Undo', onClick: () => void run(taskId, undoParentId) },
    });
  };
}
