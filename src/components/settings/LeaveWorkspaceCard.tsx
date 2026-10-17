'use client';

import { IconDoorExit } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import { leaveWorkspaceAction } from '@/server/members/actions';

/**
 * Every role sees it. The only owner sees it locked, since leaving would strand
 * the workspace; the server refuses them too.
 */
export function LeaveWorkspaceCard({
  workspaceSlug,
  name,
  soleOwner,
}: {
  workspaceSlug: string;
  name: string;
  soleOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) setError(null);
  }

  async function onLeave() {
    setPending(true);
    setError(null);
    const result = await settle(leaveWorkspaceAction(workspaceSlug));
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    toast.success(`You left “${name}”.`);
    router.replace(result.data.next);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200 sm:flex-row sm:items-center">
      <div className="flex flex-1 flex-col gap-1">
        <h3 className="text-label-sm text-text-strong-950">Leave workspace</h3>
        <p className="text-paragraph-sm text-text-sub-600">
          {soleOwner
            ? 'You are the only owner. Make someone else an owner in Members first, or delete the workspace.'
            : 'You lose access to its projects and tasks. Someone will need to invite you to come back.'}
        </p>
      </div>

      <Modal.Root open={open} onOpenChange={onOpenChange}>
        <Modal.Trigger asChild>
          <Button.Root size="small" variant="error" mode="stroke" className="shrink-0" disabled={soleOwner}>
            Leave workspace
          </Button.Root>
        </Modal.Trigger>
        <Modal.Content>
          <Modal.Header
            icon={IconDoorExit}
            title={`Leave “${name}”?`}
            description="You lose access to its projects and tasks. Tasks assigned to you stay assigned until someone changes them. To come back, someone will need to invite you again."
          />
          {error && (
            <Modal.Body>
              <FormError>{error}</FormError>
            </Modal.Body>
          )}
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full" disabled={pending}>
                Cancel
              </Button.Root>
            </Modal.Close>
            <Button.Root type="button" variant="error" size="small" className="w-full" disabled={pending} onClick={onLeave}>
              {pending ? 'Leaving…' : 'Leave workspace'}
            </Button.Root>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </div>
  );
}
