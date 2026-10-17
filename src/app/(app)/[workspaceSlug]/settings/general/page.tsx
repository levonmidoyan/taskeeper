import { DeleteWorkspaceCard } from '@/components/settings/DeleteWorkspaceCard';
import { TimezoneForm } from '@/components/settings/TimezoneForm';
import { WorkspaceLogoForm } from '@/components/settings/WorkspaceLogoForm';
import { requireWorkspace } from '@/lib/session';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const workspace = (await listMyWorkspaces(ctx.userId)).find((w) => w.id === ctx.workspaceId);
  const canEdit = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">General</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Workspace-wide preferences.</p>
      </div>

      <WorkspaceLogoForm
        workspaceSlug={workspaceSlug}
        workspaceId={ctx.workspaceId}
        name={workspace?.name ?? ''}
        current={workspace?.logo ?? null}
        canEdit={canEdit}
      />

      <TimezoneForm workspaceSlug={workspaceSlug} current={ctx.workspaceTimezone} canEdit={canEdit} />

      {ctx.role === 'owner' && workspace && <DeleteWorkspaceCard workspaceSlug={workspaceSlug} name={workspace.name} />}
    </div>
  );
}
