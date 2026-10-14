import { InboxList } from '@/components/shell/InboxList';
import { requireWorkspace } from '@/lib/session';
import { listNotifications } from '@/server/notifications/queries';

export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const items = await listNotifications(ctx, 50);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-8">
      <InboxList workspaceSlug={workspaceSlug} initialItems={items} />
    </main>
  );
}
