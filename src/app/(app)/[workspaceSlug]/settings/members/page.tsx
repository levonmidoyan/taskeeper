import { InviteForm } from '@/components/settings/InviteForm';
import { MemberTable } from '@/components/settings/MemberTable';
import { requireWorkspace } from '@/lib/session';
import { listWorkspaceMembers } from '@/server/labels/queries';

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const members = await listWorkspaceMembers(ctx);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">Members</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">
          Everyone here can see and edit every project in this workspace.
        </p>
      </div>

      {canManage && <InviteForm workspaceSlug={workspaceSlug} />}

      <MemberTable
        members={members}
        workspaceSlug={workspaceSlug}
        currentUserId={ctx.userId}
        currentRole={ctx.role}
      />
    </div>
  );
}
