import { headers } from 'next/headers';
import { LiveRefresh } from '@/components/shell/LiveRefresh';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { requireWorkspace, signInRedirect } from '@/lib/session';
import { getWorkspaceVersion } from '@/server/changes/queries';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();

  const ctx = await requireWorkspace(workspaceSlug);
  const version = await getWorkspaceVersion(ctx);

  return (
    <WorkspaceShell ctx={ctx}>
      <LiveRefresh slug={ctx.slug} version={version} />
      {children}
    </WorkspaceShell>
  );
}
