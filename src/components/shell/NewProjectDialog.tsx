'use client';

import { IconFolderPlus, IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Modal from '@/components/ui/modal';
import { createProjectAction } from '@/server/projects/actions';

export function NewProjectDialog({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await createProjectAction(workspaceSlug, { name });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.push(`/${workspaceSlug}/projects/${result.data.id}`);
  }

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Modal.Trigger asChild>
        <CompactButton.Root variant="ghost" size="medium" aria-label="New project">
          <CompactButton.Icon as={IconPlus} />
        </CompactButton.Root>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header
          icon={IconFolderPlus}
          title="New project"
          description="It starts with three columns: Todo, In Progress, and Done."
        />
        <form onSubmit={onSubmit}>
          <Modal.Body className="flex flex-col gap-3">
            <TextField id="project-name" label="Project name" name="name" required maxLength={64} autoFocus />
            {error && <FormError>{error}</FormError>}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">
                Cancel
              </Button.Root>
            </Modal.Close>
            <Button.Root type="submit" size="small" disabled={pending} className="w-full">
              {pending ? 'Creating…' : 'Create project'}
            </Button.Root>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
