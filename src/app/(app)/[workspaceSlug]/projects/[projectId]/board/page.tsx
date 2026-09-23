import { notFound } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { requireWorkspace } from '@/lib/session';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { getTask, listProjectTasks } from '@/server/tasks/queries';

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
  const openTask = openTaskId ? await getTask(ctx, openTaskId) : null;
  const [members, allLabels] = openTask
    ? await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx)])
    : [[], []];

  return (
    <main className="flex h-dvh flex-col">
      <ProjectHeader name={project.name} basePath={basePath} />
      <Board
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        statuses={project.statuses}
        tasks={tasks}
        timezone={ctx.timezone}
      />
      {openTask && (
        <TaskDetailPanel
          task={openTask}
          statuses={project.statuses}
          members={members}
          allLabels={allLabels}
          workspaceSlug={workspaceSlug}
        />
      )}
    </main>
  );
}
