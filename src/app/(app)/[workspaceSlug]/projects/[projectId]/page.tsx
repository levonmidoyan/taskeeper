import { notFound } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ManageColumnsDialog } from '@/components/board/ManageColumnsDialog';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

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
  const canEditColumns = ctx.role === 'owner' || ctx.role === 'admin';

  // Viewport minus the h-14 app header, so the board scrolls inside itself.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
      >
        <ManageColumnsDialog
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statuses={project.statuses}
          canEdit={canEditColumns}
        />
      </ProjectHeader>
      <Board
        workspaceSlug={workspaceSlug}
        statuses={project.statuses}
        tasks={tasks}
        timezone={ctx.timezone}
        canEditColumns={canEditColumns}
      />
      <ProjectTaskDialog
        ctx={ctx}
        taskId={openTaskId}
        projectId={projectId}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
      />
    </main>
  );
}
