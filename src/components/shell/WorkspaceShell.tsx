import { AppHeader } from '@/components/shell/AppHeader';
import { RememberWorkspace } from '@/components/shell/RememberWorkspace';
import { Rail } from '@/components/shell/Rail';
import type { WorkspaceContext } from '@/lib/session';
import { unreadCount } from '@/server/notifications/queries';
import { listProjects } from '@/server/projects/queries';
import { listMyWorkspaces } from '@/server/workspaces/queries';

/** Rail plus content column under the app header. Shared by workspace pages and account settings so both look like one app. */
export async function WorkspaceShell({
  ctx,
  children,
}: {
  ctx: WorkspaceContext;
  children: React.ReactNode;
}) {
  const [projects, workspaces, unread] = await Promise.all([
    listProjects(ctx),
    listMyWorkspaces(ctx.userId),
    unreadCount(ctx),
  ]);

  // Mirrors the role check in the project services; the server still enforces it.
  const canManageProjects = ctx.role === 'owner' || ctx.role === 'admin';
  const railProps = { workspaceSlug: ctx.slug, workspaces, projects, canManageProjects };

  return (
    <div className="flex min-h-dvh bg-bg-white-0">
      <RememberWorkspace slug={ctx.slug} />
      <Rail {...railProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader {...railProps} unread={unread} />
        {children}
      </div>
    </div>
  );
}
