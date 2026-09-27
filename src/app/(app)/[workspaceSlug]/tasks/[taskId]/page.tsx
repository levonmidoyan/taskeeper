import { notFound } from 'next/navigation';
import { TaskDetailView } from '@/components/task/TaskDetailView';
import { requireWorkspace } from '@/lib/session';
import { listTaskFeed } from '@/server/activity/queries';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { getTaskDetail } from '@/server/tasks/queries';

/**
 * A task on its own page, the link to share. Project views still open tasks
 * in the ?task= modal; this is where search, home and copied links land.
 */
export default async function TaskPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; taskId: string }>;
}) {
  const { workspaceSlug, taskId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const task = await getTaskDetail(ctx, taskId);
  if (!task) notFound();

  const [project, members, allLabels, feed] = await Promise.all([
    getProject(ctx, task.projectId),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
    listTaskFeed(ctx, task.id),
  ]);
  if (!project) notFound();

  // Viewport minus the h-14 app header, so each column scrolls inside itself.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <TaskDetailView
        mode="page"
        // Remounted per task, so the title and description fields reset when
        // moving between a parent and one of its subtasks.
        key={task.id}
        task={task}
        projectId={project.id}
        projectName={project.name}
        statuses={project.statuses}
        members={members}
        allLabels={allLabels}
        workspaceSlug={workspaceSlug}
        feed={feed}
        currentUserId={ctx.userId}
        canModerate={ctx.role === 'owner' || ctx.role === 'admin'}
        timezone={ctx.timezone}
      />
    </main>
  );
}
