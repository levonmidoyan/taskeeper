import { WorkspaceSettingsTabs } from '@/components/settings/SettingsTabs';
import { WorkspaceSettingsBreadcrumb } from '@/components/settings/WorkspaceSettingsBreadcrumb';

export default async function WorkspaceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 lg:px-6">
      <div>
        <WorkspaceSettingsBreadcrumb className="mb-3" workspaceSlug={workspaceSlug} />
        <h1 className="text-title-h5 text-text-strong-950">Workspace settings</h1>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Preferences and people for this workspace.</p>
      </div>
      <WorkspaceSettingsTabs workspaceSlug={workspaceSlug}>{children}</WorkspaceSettingsTabs>
    </main>
  );
}
