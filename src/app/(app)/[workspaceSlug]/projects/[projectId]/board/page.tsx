import { notFound } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

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
    </main>
  );
}
