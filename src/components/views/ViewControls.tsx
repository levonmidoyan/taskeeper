'use client';

import { IconAlertTriangle, IconBookmark } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Badge from '@/components/ui/badge';
import * as Button from '@/components/ui/button';
import { settle } from '@/lib/settle';
import { isFiltered, type TaskFilter } from '@/lib/task-filter';
import { defaultState, viewHref, type ViewLayout } from '@/lib/views';
import { createViewAction, updateViewAction } from '@/server/views/actions';
import type { SavedView } from '@/server/views/queries';
import { SaveViewDialog } from './SaveViewDialog';
import { ViewMenu } from './ViewMenu';

export function ViewControls({
  workspaceSlug,
  projectId,
  layout,
  view,
  modified,
  filter,
  sort,
}: {
  workspaceSlug: string;
  projectId: string | null;
  layout: ViewLayout;
  view: SavedView | null;
  modified: boolean;
  filter: TaskFilter;
  sort: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();

  async function saveNew(name: string, shared: boolean): Promise<string | null> {
    const result = await settle(createViewAction(workspaceSlug, { projectId, name, shared, layout, filter, sort }));
    if (!result.ok) return result.error;
    toast.success(`Saved view “${name.trim()}”.`);
    router.push(viewHref(workspaceSlug, { id: result.data.id, projectId, layout, filter, sort }));
    return null;
  }

  function saveChanges() {
    if (!view) return;
    startTransition(async () => {
      const result = await settle(updateViewAction(workspaceSlug, { id: view.id, filter, sort }));
      if (!result.ok) toast.error(result.error);
      else toast.success(`Updated “${view.name}”.`);
    });
  }

  const dialog = (
    <SaveViewDialog open={saving} onOpenChange={setSaving} title={view ? 'Save as new view' : 'Save view'} submitLabel="Save view" onSave={saveNew} />
  );

  if (!view) {
    if (!isFiltered(filter, defaultState(layout)) && !sort) return null;
    return (
      <>
        <Button.Root variant="neutral" mode="stroke" size="xxsmall" onClick={() => setSaving(true)}>
          <Button.Icon as={IconBookmark} />Save view
        </Button.Root>
        {dialog}
      </>
    );
  }

  return (
    <>
      {view.filterReset && (
        <span className="inline-flex items-center gap-1 text-paragraph-xs text-warning-base">
          <IconAlertTriangle className="size-4" aria-hidden="true" />
          This view’s filter couldn’t be read and was reset.
        </span>
      )}
      <span className="max-w-40 truncate text-label-sm text-text-strong-950">{view.name}</span>
      {modified && (
        <>
          <Badge.Root variant="lighter" color="orange" size="small">Modified</Badge.Root>
          {view.canEdit && (
            <Button.Root size="xxsmall" disabled={pending} onClick={saveChanges}>Save</Button.Root>
          )}
          <Button.Root variant="neutral" mode="stroke" size="xxsmall" onClick={() => setSaving(true)}>Save as new</Button.Root>
          <Button.Root variant="neutral" mode="ghost" size="xxsmall" asChild>
            <Link href={viewHref(workspaceSlug, view)}>Reset</Link>
          </Button.Root>
        </>
      )}
      <ViewMenu workspaceSlug={workspaceSlug} view={view} placement="bar" />
      {dialog}
    </>
  );
}
