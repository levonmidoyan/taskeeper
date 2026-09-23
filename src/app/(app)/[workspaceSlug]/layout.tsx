import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Rail } from '@/components/shell/Rail';
import { auth } from '@/lib/auth';
import { requireWorkspace } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const ctx = await requireWorkspace(workspaceSlug);
  const [projects, workspaces] = await Promise.all([
    listProjects(ctx),
    listMyWorkspaces(ctx.userId),
  ]);

  return (
    <div className="flex min-h-dvh bg-background">
      <Rail
        workspaceSlug={ctx.slug}
        workspaces={workspaces}
        projects={projects}
        userName={session.user.name}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
