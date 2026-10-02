import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { TaskTable } from '@/components/task/TaskTable';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  const { task: openTaskId } = await searchParams;

  return (
    <main>
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
        menu={canManage && <ProjectMenu workspaceSlug={workspaceSlug} projectId={projectId} name={project.name} />}
      />
      <TaskTable
        tasks={tasks}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        timezone={ctx.timezone}
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
