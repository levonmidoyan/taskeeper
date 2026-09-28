import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccountBreadcrumb } from '@/components/settings/AccountBreadcrumb';
import { AccountSettingsTabs } from '@/components/settings/SettingsTabs';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { resolveShellWorkspace } from '@/lib/shell-workspace';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in?redirectTo=/settings');

  // Account settings have no workspace in the URL. Keep the rail of the one the
  // user came from.
  const ctx = await resolveShellWorkspace(session.user.id);
  if (!ctx) redirect('/new-workspace');

  return (
    <WorkspaceShell ctx={ctx} userName={session.user.name}>
      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 lg:px-6">
        <div>
          <AccountBreadcrumb className="mb-3" workspaceSlug={ctx.slug} />
          <h1 className="text-title-h5 text-text-strong-950">Account</h1>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Your profile, sign-in and sessions.</p>
        </div>
        <AccountSettingsTabs>{children}</AccountSettingsTabs>
      </main>
    </WorkspaceShell>
  );
}
