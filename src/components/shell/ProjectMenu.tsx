'use client';

import { IconArchive, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as Dropdown from '@/components/ui/dropdown';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import {
  archiveProjectAction, deleteProjectAction, renameProjectAction, unarchiveProjectAction,
} from '@/server/projects/actions';

/**
 * Rename, archive and delete for one project, beside its title. Owners and admins
 * only; the page leaves it out for everyone else, and the services refuse anyway.
 *
 * Archive and delete take the caller off this page: the action skips its own
 * revalidation (the page would re-render as a 404 first), and the push plus
 * refresh below bring the rail up to date from the workspace home instead.
 */
export function ProjectMenu({
  workspaceSlug,
  projectId,
  name,
}: {
  workspaceSlug: string;
  projectId: string;
  name: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Rename opens its dialog only once the menu has finished closing. Opened any
  // earlier, the closing menu keeps focus through its exit animation and then
  // drops it on <body>, so the name field never gets it.
  const renameNext = useRef(false);

  function leave() {
    router.push(`/${workspaceSlug}`);
    router.refresh();
  }

  function onRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get('name'));
    startTransition(async () => {
      setRenameError(null);
      const result = await settle(renameProjectAction(workspaceSlug, { projectId, name: next }));
      if (!result.ok) {
        setRenameError(result.error);
        return;
      }
      setRenaming(false);
    });
  }

  function onArchive() {
    startTransition(async () => {
      const result = await settle(archiveProjectAction(workspaceSlug, { projectId }, { leaving: true }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      leave();
      toast.success(`“${name}” archived.`, {
        description: 'Restore it any time from Workspace settings → Projects.',
        action: { label: 'Undo', onClick: () => void undoArchive() },
      });
    });
  }

  async function undoArchive() {
    const result = await settle(unarchiveProjectAction(workspaceSlug, { projectId }));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.push(`/${workspaceSlug}/projects/${projectId}`);
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: 'Its tasks, comments and files are deleted for everyone. This cannot be undone.',
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await settle(deleteProjectAction(workspaceSlug, { projectId }, { leaving: true }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      leave();
      toast.success(`“${name}” deleted.`);
    });
  }

  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <CompactButton.Root ref={trigger} variant="ghost" size="large" aria-label="Project actions" disabled={pending}>
            <CompactButton.Icon as={IconDots} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content
          align="start"
          className="w-48"
          onCloseAutoFocus={(event) => {
            if (!renameNext.current) return;
            renameNext.current = false;
            event.preventDefault();
            setRenaming(true);
          }}
        >
          <Dropdown.Item
            onSelect={() => {
              renameNext.current = true;
              setRenameError(null);
            }}
          >
            <Dropdown.ItemIcon as={IconPencil} />
            Rename
          </Dropdown.Item>
          <Dropdown.Item onSelect={onArchive}>
            <Dropdown.ItemIcon as={IconArchive} />
            Archive
          </Dropdown.Item>
          <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
          <Dropdown.Item onSelect={() => void onDelete()} className="text-error-base">
            <Dropdown.ItemIcon as={IconTrash} className="text-error-base" />
            Delete
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>

      <Modal.Root open={renaming} onOpenChange={setRenaming}>
        {/* No Modal.Trigger to return to; focus goes back to the menu button instead. */}
        <Modal.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <Modal.Header icon={IconPencil} title="Rename project" />
          <form onSubmit={onRename}>
            <Modal.Body className="flex flex-col gap-3">
              <TextField
                id="rename-project"
                label="Project name"
                name="name"
                defaultValue={name}
                required
                maxLength={64}
                autoFocus
              />
              {renameError && <FormError>{renameError}</FormError>}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close asChild>
                <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">
                  Cancel
                </Button.Root>
              </Modal.Close>
              <Button.Root type="submit" size="small" disabled={pending} className="w-full">
                {pending ? 'Saving…' : 'Save'}
              </Button.Root>
            </Modal.Footer>
          </form>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
