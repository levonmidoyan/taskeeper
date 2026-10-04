'use client';

import { IconBookmark } from '@tabler/icons-react';
import { useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Modal from '@/components/ui/modal';
import * as Switch from '@/components/ui/switch';

/** Name + Private/Shared. Used for Save view, Save as new and Rename (no switch). */
export function SaveViewDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = '',
  showShared = true,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  showShared?: boolean;
  /** Resolves to an error message, or null when saved. */
  onSave: (name: string, shared: boolean) => Promise<string | null>;
}) {
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSave(String(new FormData(event.currentTarget).get('name')), shared);
    setPending(false);
    if (message) setError(message);
    else onOpenChange(false);
  }

  return (
    <Modal.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setError(null); setShared(false); } }}>
      <Modal.Content>
        <Modal.Header icon={IconBookmark} title={title} />
        <form onSubmit={onSubmit}>
          <Modal.Body className="flex flex-col gap-3">
            <TextField id="view-name" label="View name" name="name" required maxLength={60} defaultValue={initialName} autoFocus />
            {showShared && (
              <label className="flex items-center justify-between gap-3 text-label-sm text-text-strong-950">
                <span>
                  Share with the workspace
                  <span className="block text-paragraph-xs text-text-sub-600">
                    Everyone can open it; only you and admins can change it.
                  </span>
                </span>
                <Switch.Root checked={shared} onCheckedChange={setShared} aria-label="Share with the workspace" />
              </label>
            )}
            {error && <FormError>{error}</FormError>}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">Cancel</Button.Root>
            </Modal.Close>
            <Button.Root type="submit" size="small" disabled={pending} className="w-full">
              {pending ? 'Saving…' : submitLabel}
            </Button.Root>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
