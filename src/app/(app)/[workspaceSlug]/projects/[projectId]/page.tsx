import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { TaskList } from '@/components/task/TaskList';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectListPage({
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
    <main>
      <ProjectHeader name={project.name} basePath={basePath} />
      <TaskList
        tasks={tasks}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        timezone={ctx.timezone}
      />
    </main>
  );
}
