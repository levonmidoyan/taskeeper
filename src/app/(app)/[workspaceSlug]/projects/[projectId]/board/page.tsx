import { notFound } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ManageColumnsDialog } from '@/components/board/ManageColumnsDialog';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { TaskDetailDialog } from '@/components/task/TaskDetailDialog';
import { requireWorkspace } from '@/lib/session';
import { listTaskFeed } from '@/server/activity/queries';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { getTaskDetail, listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  const { task: openTaskId } = await searchParams;
  const openTask = openTaskId ? await getTaskDetail(ctx, openTaskId) : null;
  const [members, allLabels, feed] = openTask
    ? await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx), listTaskFeed(ctx, openTask.id)])
    : [[], [], []];

  return (
    <main className="flex h-dvh flex-col">
      <ProjectHeader name={project.name} basePath={basePath}>
        <ManageColumnsDialog
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statuses={project.statuses}
          canEdit={ctx.role === 'owner' || ctx.role === 'admin'}
        />
      </ProjectHeader>
      <Board
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        statuses={project.statuses}
        tasks={tasks}
        timezone={ctx.timezone}
      />
      {openTask && (
        <TaskDetailDialog
          // Remounted per task, so the title and description fields reset when
          // the dialog swaps between a parent and one of its subtasks.
          key={openTask.id}
          task={openTask}
          projectId={projectId}
          statuses={project.statuses}
          members={members}
          allLabels={allLabels}
          workspaceSlug={workspaceSlug}
          feed={feed}
          currentUserId={ctx.userId}
          canModerate={ctx.role === 'owner' || ctx.role === 'admin'}
          timezone={ctx.timezone}
        />
      )}
    </main>
  );
}
