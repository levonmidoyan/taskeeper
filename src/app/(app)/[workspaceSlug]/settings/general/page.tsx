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
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">General</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Workspace-wide preferences.</p>
      </div>

      <TimezoneForm
        workspaceSlug={workspaceSlug}
        current={ctx.workspaceTimezone}
        canEdit={ctx.role === 'owner' || ctx.role === 'admin'}
      />
    </div>
  );
}
