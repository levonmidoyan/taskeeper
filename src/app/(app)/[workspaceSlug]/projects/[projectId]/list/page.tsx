import { notFound, redirect } from 'next/navigation';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterEmpty } from '@/components/filters/FilterEmpty';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { TaskTable } from '@/components/task/TaskTable';
import { requireWorkspace } from '@/lib/session';
import { isFiltered } from '@/lib/task-filter';
import { defaultState } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';
import { resolveView } from '@/server/views/resolve';

export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const sp = await searchParams;
  const resolved = await resolveView(ctx, sp, { layout: 'list', projectId });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const [tasks, members, labels] = await Promise.all([
    listProjectTasks(ctx, projectId, resolved.filter),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
  ]);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  const openTaskId = typeof sp.task === 'string' ? sp.task : undefined;
  const options = { statuses: project.statuses, members, labels };
  const filtered = isFiltered(resolved.filter, defaultState('list'));

  return (
    <main>
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
        menu={canManage && <ProjectMenu workspaceSlug={workspaceSlug} projectId={projectId} name={project.name} />}
      />
      <FilterScope>
        <FilterBar filter={resolved.filter} defaultState={defaultState('list')} options={options} />
        {resolved.viewMissing && <ViewNotFound />}
        <FilterResults>
          {filtered && tasks.length === 0 ? (
            <FilterEmpty defaultState={defaultState('list')} />
          ) : (
            <TaskTable
              tasks={tasks}
              statuses={project.statuses}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              timezone={ctx.timezone}
            />
          )}
        </FilterResults>
      </FilterScope>
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
