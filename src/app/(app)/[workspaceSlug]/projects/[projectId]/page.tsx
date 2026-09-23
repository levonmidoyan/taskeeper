import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { TaskList } from '@/components/task/TaskList';
import { requireWorkspace } from '@/lib/session';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { getTask, listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectListPage({
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

  // The panel is driven by ?task=<id>, so it is deep-linkable and the browser's
  // back button closes it (spec §6.3).
  const { task: openTaskId } = await searchParams;
  const openTask = openTaskId ? await getTask(ctx, openTaskId) : null;
  const [members, allLabels] = openTask
    ? await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx)])
    : [[], []];

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
