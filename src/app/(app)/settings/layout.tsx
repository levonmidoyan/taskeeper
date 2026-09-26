import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { LAST_WORKSPACE_COOKIE } from '@/lib/last-workspace';
import { resolveWorkspace } from '@/lib/session';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in?redirectTo=/settings');

  // Account settings have no workspace in the URL. Keep the rail of the one the
  // user came from; the cookie is only a hint, so membership is checked again.
  const remembered = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  let ctx = remembered ? await resolveWorkspace(session.user.id, remembered) : null;
  if (!ctx) {
    const [first] = await listMyWorkspaces(session.user.id);
    if (!first) redirect('/new-workspace');
    ctx = await resolveWorkspace(session.user.id, first.slug);
    if (!ctx) redirect('/new-workspace');
  }

  return (
    <WorkspaceShell ctx={ctx} userName={session.user.name}>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 pl-16 lg:px-6 lg:pl-6">
        <div>
          <h1 className="text-title-h5 text-text-strong-950">Account</h1>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Your profile, sign-in and sessions.</p>
        </div>
        {children}
      </main>
    </WorkspaceShell>
  );
}
