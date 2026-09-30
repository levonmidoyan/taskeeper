import { TaskDetailDialog } from '@/components/task/TaskDetailDialog';
import type { WorkspaceContext } from '@/lib/session';
import { storageEnabled } from '@/lib/storage';
import { listTaskFeed } from '@/server/activity/queries';
import { listTaskAttachments } from '@/server/attachments/queries';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { getTaskDetail } from '@/server/tasks/queries';

/**
 * The task dialog every project view opens from ?task=<id>, so it is
 * deep-linkable and the browser's back button closes it (spec §6.3). A server
 * component rather than a layout, because layouts cannot read searchParams.
 */
export async function ProjectTaskDialog({
  ctx,
  taskId,
  projectId,
  statuses,
  workspaceSlug,
}: {
  ctx: WorkspaceContext;
  taskId: string | undefined;
  projectId: string;
  statuses: StatusRow[];
  workspaceSlug: string;
}) {
  const task = taskId ? await getTaskDetail(ctx, taskId) : null;
  // A ?task= from another project would open with this project's columns, and
  // every status pick would then fail against the task's real project.
  if (!task || task.projectId !== projectId) return null;

  const [members, allLabels, feed, attachments] = await Promise.all([
    listWorkspaceMembers(ctx), listLabels(ctx), listTaskFeed(ctx, task.id),
    storageEnabled() ? listTaskAttachments(ctx, task.id) : null,
  ]);

  return (
    <TaskDetailDialog
      // Remounted per task, so the title and description fields reset when
      // the dialog swaps between a parent and one of its subtasks.
      key={task.id}
      task={task}
      projectId={projectId}
      statuses={statuses}
      members={members}
      allLabels={allLabels}
      workspaceSlug={workspaceSlug}
      feed={feed}
      currentUserId={ctx.userId}
      canModerate={ctx.role === 'owner' || ctx.role === 'admin'}
      timezone={ctx.timezone}
      attachments={attachments}
    />
  );
}
