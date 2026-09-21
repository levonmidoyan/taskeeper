import { requireWorkspace } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const projects = await listProjects(ctx);

  return (
    <main className="p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {projects.length === 0
          ? 'Create your first project from the sidebar to get started.'
          : `${projects.length} active ${projects.length === 1 ? 'project' : 'projects'}.`}
      </p>
    </main>
  );
}
