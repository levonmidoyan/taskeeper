import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { requireWorkspace } from '@/lib/session';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');

  const ctx = await requireWorkspace(workspaceSlug);

  return (
    <WorkspaceShell ctx={ctx} userName={session.user.name}>
      {children}
    </WorkspaceShell>
  );
}
