import { ArchivedProjectList } from '@/components/settings/ArchivedProjectList';
import { requireWorkspace } from '@/lib/session';
import { listArchivedProjects } from '@/server/projects/queries';

export default async function ProjectsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const projects = await listArchivedProjects(ctx);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">Archived projects</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">
          Hidden from the sidebar and read-only.
          {canManage ? ' Restore one to bring back its board, tasks and files.' : ' Owners and admins can restore them.'}
        </p>
      </div>

      <ArchivedProjectList
        projects={projects}
        workspaceSlug={workspaceSlug}
        timezone={ctx.timezone}
        canManage={canManage}
      />
    </div>
  );
}
