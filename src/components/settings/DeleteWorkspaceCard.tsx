'use client';

import { IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import { deleteWorkspaceAction } from '@/server/workspaces/actions';

/** Owners only. The dialog asks for the workspace's name before the button unlocks. */
export function DeleteWorkspaceCard({ workspaceSlug, name }: { workspaceSlug: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setTyped('');
      setError(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await settle(deleteWorkspaceAction(workspaceSlug, { confirmName: typed }));
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    toast.success(`“${name}” deleted.`);
    router.replace(result.data.next);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200 sm:flex-row sm:items-center">
      <div className="flex flex-1 flex-col gap-1">
        <h3 className="text-label-sm text-text-strong-950">Delete workspace</h3>
        <p className="text-paragraph-sm text-text-sub-600">
          Deletes every project, task, comment and file in it, for all members. This cannot be undone.
        </p>
      </div>

      <Modal.Root open={open} onOpenChange={onOpenChange}>
        <Modal.Trigger asChild>
          <Button.Root size="small" variant="error" mode="stroke" className="shrink-0">
            Delete workspace
          </Button.Root>
        </Modal.Trigger>
        <Modal.Content>
          <Modal.Header
            icon={IconTrash}
            title={`Delete “${name}”?`}
            description="Every project, task, comment and file in it is deleted for all members. This cannot be undone."
          />
          <form onSubmit={onSubmit}>
            <Modal.Body className="flex flex-col gap-3">
              <TextField
                id="delete-workspace-name"
                label={`Type “${name}” to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                disabled={pending}
              />
              {error && <FormError>{error}</FormError>}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close asChild>
                <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full" disabled={pending}>
                  Cancel
                </Button.Root>
              </Modal.Close>
              <Button.Root
                type="submit"
                variant="error"
                size="small"
                className="w-full"
                disabled={pending || typed.trim() !== name}
              >
                {pending ? 'Deleting…' : 'Delete workspace'}
              </Button.Root>
            </Modal.Footer>
          </form>
        </Modal.Content>
      </Modal.Root>
    </div>
  );
}
