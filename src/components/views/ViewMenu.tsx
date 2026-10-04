'use client';

import { IconCopy, IconDotsVertical, IconLock, IconPencil, IconTrash, IconUsers } from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as Dropdown from '@/components/ui/dropdown';
import { settle } from '@/lib/settle';
import { viewHref } from '@/lib/views';
import { deleteViewAction, duplicateViewAction, updateViewAction } from '@/server/views/actions';
import type { SavedView } from '@/server/views/queries';
import { cn } from '@/utils/cn';
import { SaveViewDialog } from './SaveViewDialog';

export function ViewMenu({
  workspaceSlug,
  view,
  placement,
  className,
}: {
  workspaceSlug: string;
  view: SavedView;
  placement: 'bar' | 'rail';
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const renameNext = useRef(false);
  const [shown, setShown] = useState(false);
  const isOpen = searchParams.get('view') === view.id;

  function run<T>(call: Promise<{ ok: true; data: T } | { ok: false; error: string }>, then: (data: T) => void) {
    startTransition(async () => {
      const result = await settle(call);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      then(result.data);
    });
  }

  function onDuplicate() {
    run(duplicateViewAction(workspaceSlug, { id: view.id }), ({ id }) => {
      toast.success(`Saved “${view.name} (copy)”.`);
      router.push(viewHref(workspaceSlug, { ...view, id }));
    });
  }

  function onShare() {
    run(updateViewAction(workspaceSlug, { id: view.id, shared: !view.shared }), () =>
      toast.success(view.shared ? 'Only you can see this view now.' : 'Shared with the workspace.'));
  }

  async function onDelete() {
    const ok = await confirm({ title: `Delete “${view.name}”?`, description: view.shared ? 'It disappears for everyone.' : 'This cannot be undone.' });
    if (!ok) return;
    run(deleteViewAction(workspaceSlug, { id: view.id }), () => {
      toast.success(`“${view.name}” deleted.`);
      if (isOpen) {
        const next = new URLSearchParams(searchParams);
        next.delete('view');
        router.replace(`${pathname}?${next.toString()}`);
      }
    });
  }

  return (
    <>
      <Dropdown.Root onOpenChange={(open) => open && setShown(true)}>
        <Dropdown.Trigger asChild>
          <CompactButton.Root
            variant="ghost"
            size="medium"
            aria-label={`Actions for view ${view.name}`}
            disabled={pending}
            data-shown={shown || undefined}
            className={cn(placement === 'rail' && 'size-6', className)}
          >
            <CompactButton.Icon as={IconDotsVertical} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content
          align="end"
          onCloseAutoFocus={(e) => {
            setShown(false);
            if (renameNext.current) {
              renameNext.current = false;
              e.preventDefault();
              setRenaming(true);
            }
          }}
        >
          {view.canEdit && (
            <>
              <Dropdown.Item onSelect={() => { renameNext.current = true; }}>
                <Dropdown.ItemIcon as={IconPencil} />Rename
              </Dropdown.Item>
              <Dropdown.Item onSelect={onShare}>
                <Dropdown.ItemIcon as={view.shared ? IconLock : IconUsers} />
                {view.shared ? 'Make private' : 'Share with workspace'}
              </Dropdown.Item>
            </>
          )}
          <Dropdown.Item onSelect={onDuplicate}>
            <Dropdown.ItemIcon as={IconCopy} />Duplicate
          </Dropdown.Item>
          {view.canEdit && (
            <Dropdown.Item onSelect={() => void onDelete()} className="text-error-base">
              <Dropdown.ItemIcon as={IconTrash} />Delete
            </Dropdown.Item>
          )}
        </Dropdown.Content>
      </Dropdown.Root>
      <SaveViewDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename view"
        submitLabel="Rename"
        initialName={view.name}
        showShared={false}
        onSave={async (name) => {
          const result = await settle(updateViewAction(workspaceSlug, { id: view.id, name }));
          return result.ok ? null : result.error;
        }}
      />
    </>
  );
}
