import { notFound, redirect } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ManageColumnsDialog } from '@/components/board/ManageColumnsDialog';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterEmpty } from '@/components/filters/FilterEmpty';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { ViewControls } from '@/components/views/ViewControls';
import { requireWorkspace } from '@/lib/session';
import { hiddenStatusIds, isFiltered } from '@/lib/task-filter';
import { defaultState } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';
import { listViews } from '@/server/views/queries';
import { resolveView } from '@/server/views/resolve';

export default async function ProjectBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const sp = await searchParams;
  const resolved = await resolveView(ctx, sp, { layout: 'board', projectId });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const [tasks, members, labels, views] = await Promise.all([
    listProjectTasks(ctx, projectId, resolved.filter),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
    listViews(ctx, { projectId }),
  ]);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  const openTaskId = typeof sp.task === 'string' ? sp.task : undefined;
  const options = { statuses: project.statuses, members, labels };
  const filtered = isFiltered(resolved.filter, defaultState('board'));
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  // Viewport minus the h-14 app header, so the board scrolls inside itself.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
        menu={canManage && <ProjectMenu workspaceSlug={workspaceSlug} projectId={projectId} name={project.name} />}
        workspaceSlug={workspaceSlug}
        views={views}
      >
        <ManageColumnsDialog
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statuses={project.statuses}
          canEdit={canManage}
        />
      </ProjectHeader>
      <FilterScope filter={resolved.filter}>
        <FilterBar defaultState={defaultState('board')} options={options}>
          <ViewControls
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            layout="board"
            view={resolved.view}
            modified={resolved.modified}
            filter={resolved.filter}
            sort={resolved.sort}
          />
        </FilterBar>
        {resolved.viewMissing && <ViewNotFound />}
        {filtered && tasks.length === 0 && <FilterEmpty defaultState={defaultState('board')} />}
        <FilterResults className="flex min-h-0 flex-1 flex-col">
          <Board
            workspaceSlug={workspaceSlug}
            statuses={project.statuses}
            tasks={tasks}
            timezone={ctx.timezone}
            canEditColumns={canManage}
            hiddenStatusIds={hiddenStatusIds(resolved.filter, project.statuses)}
          />
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
