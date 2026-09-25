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
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <div>
        <h1 className="text-title-h5 text-text-strong-950">Members</h1>
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
    </main>
  );
}
