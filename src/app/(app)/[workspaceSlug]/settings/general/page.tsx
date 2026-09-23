import { TimezoneForm } from '@/components/settings/TimezoneForm';
import { requireWorkspace } from '@/lib/session';

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-wide preferences.</p>
      </div>

      <TimezoneForm
        workspaceSlug={workspaceSlug}
        current={ctx.timezone}
        canEdit={ctx.role === 'owner' || ctx.role === 'admin'}
      />
    </main>
  );
}
