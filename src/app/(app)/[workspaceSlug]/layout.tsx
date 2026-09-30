import { headers } from 'next/headers';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { requireWorkspace, signInRedirect } from '@/lib/session';

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

  return (
    <WorkspaceShell ctx={ctx}>
      {children}
    </WorkspaceShell>
  );
}
