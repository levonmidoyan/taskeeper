import { IconArrowLeft } from '@tabler/icons-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/auth/ui/card';
import { AuthShell } from '@/components/brand/AuthShell';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { NewWorkspaceForm } from '@/components/workspace/NewWorkspaceForm';
import { auth } from '@/lib/auth';
import { resolveShellWorkspace } from '@/lib/shell-workspace';

export default async function NewWorkspacePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in?redirectTo=/new-workspace');

  const ctx = await resolveShellWorkspace(session.user.id);

  // A first workspace is onboarding: there is no app to sit inside yet.
  if (!ctx) {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>Create a workspace</CardTitle>
            <CardDescription>A workspace holds your projects and your team.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewWorkspaceForm />
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <WorkspaceShell ctx={ctx} userName={session.user.name}>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
        <Link
          href={`/${ctx.slug}`}
          className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-label-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
        >
          <IconArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Link>
        <div className="mt-4">
          <h1 className="text-title-h5 text-text-strong-950">Create a workspace</h1>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            A workspace holds your projects and your team. You can switch between them from the sidebar.
          </p>
        </div>
        <div className="mt-6 max-w-md rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
          <NewWorkspaceForm />
        </div>
      </main>
    </WorkspaceShell>
  );
}
