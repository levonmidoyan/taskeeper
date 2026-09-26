import { RememberWorkspace } from '@/components/shell/RememberWorkspace';
import { Rail } from '@/components/shell/Rail';
import type { WorkspaceContext } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';
import { listMyWorkspaces } from '@/server/workspaces/queries';

/** Rail plus content column. Shared by workspace pages and account settings so both look like one app. */
export async function WorkspaceShell({
  ctx,
  userName,
  children,
}: {
  ctx: WorkspaceContext;
  userName: string;
  children: React.ReactNode;
}) {
  const [projects, workspaces] = await Promise.all([
    listProjects(ctx),
    listMyWorkspaces(ctx.userId),
  ]);

  return (
    <div className="flex min-h-dvh bg-bg-white-0">
      <RememberWorkspace slug={ctx.slug} />
      <Rail
        workspaceSlug={ctx.slug}
        workspaces={workspaces}
        projects={projects}
        userName={userName}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
