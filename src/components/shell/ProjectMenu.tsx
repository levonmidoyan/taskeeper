'use client';

import { IconArchive, IconDotsVertical, IconPencil, IconTrash } from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as Dropdown from '@/components/ui/dropdown';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import { cn } from '@/utils/cn';
import {
  archiveProjectAction, deleteProjectAction, renameProjectAction, unarchiveProjectAction,
} from '@/server/projects/actions';

/**
 * Rename, archive and delete for one project, beside its title and on its rail
 * row. Owners and admins only; callers leave it out for everyone else, and the
 * services refuse anyway.
 *
 * Archive and delete from inside the project take the caller off its pages: the
 * action skips its own revalidation (the page would re-render as a 404 first),
 * and the push plus refresh below bring the rail up to date from the workspace
 * home instead. From anywhere else the action revalidates as usual.
 */
export function ProjectMenu({
  workspaceSlug,
  projectId,
  name,
  placement = 'header',
  className,
}: {
  workspaceSlug: string;
  projectId: string;
  name: string;
  /** `rail`: a smaller trigger named after the project, since the rail lists many. */
  placement?: 'header' | 'rail';
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const projectPath = `/${workspaceSlug}/projects/${projectId}`;
  const onProjectPage = pathname === projectPath || pathname.startsWith(`${projectPath}/`);
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Rename opens its dialog only once the menu has finished closing. Opened any
  // earlier, the closing menu keeps focus through its exit animation and then
  // drops it on <body>, so the name field never gets it.
  const renameNext = useRef(false);
  // True from opening until the menu has finished its exit animation. The rail
  // hides its trigger when the row isn't hovered or focused, and `data-state`
  // turns `closed` as soon as closing starts; hidden that early, the trigger
  // leaves the closing menu with no anchor and it jumps to the top-left corner.
  const [shown, setShown] = useState(false);

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
      const leaving = onProjectPage;
      const result = await settle(archiveProjectAction(workspaceSlug, { projectId }, { leaving }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (leaving) leave();
      toast.success(`“${name}” archived.`, {
        description: 'Restore it any time from Workspace settings → Projects.',
        action: { label: 'Undo', onClick: () => void undoArchive(leaving) },
      });
    });
  }

  /** `returnToProject`: archiving took the caller off the project, so Undo brings them back. */
  async function undoArchive(returnToProject: boolean) {
    const result = await settle(unarchiveProjectAction(workspaceSlug, { projectId }));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (returnToProject) router.push(projectPath);
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: 'Its tasks, comments and files are deleted for everyone. This cannot be undone.',
    });
    if (!ok) return;
    startTransition(async () => {
      const leaving = onProjectPage;
      const result = await settle(deleteProjectAction(workspaceSlug, { projectId }, { leaving }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (leaving) leave();
      toast.success(`“${name}” deleted.`);
    });
  }

  return (
    <>
      <Dropdown.Root onOpenChange={(open) => open && setShown(true)}>
        <Dropdown.Trigger asChild>
          <CompactButton.Root
            ref={trigger}
            variant="ghost"
            size={placement === 'rail' ? 'medium' : 'large'}
            aria-label={placement === 'rail' ? `Actions for ${name}` : 'Project actions'}
            disabled={pending}
            data-shown={shown || undefined}
            className={cn(placement === 'rail' && 'size-6', className)}
          >
            <CompactButton.Icon as={IconDotsVertical} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content
          align="start"
          side={placement === 'rail' ? 'right' : 'bottom'}
          className="w-48"
          onCloseAutoFocus={(event) => {
            setShown(false);
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
