'use client';

import { IconCopy, IconKey, IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import {
  API_TOKEN_EXPIRY_DAYS, API_TOKEN_NAME_MAX, DEFAULT_API_TOKEN_EXPIRY_DAYS, type ApiTokenExpiryDays,
} from '@/lib/api-tokens';
import { settle } from '@/lib/settle';
import { createApiTokenAction } from '@/server/api-tokens/actions';

const NEVER = 'never';

/** Create a token, then show it once. Closing the dialog forgets it. */
export function NewApiTokenDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState(String(DEFAULT_API_TOKEN_EXPIRY_DAYS));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setToken(null);
      setError(null);
      setExpiry(String(DEFAULT_API_TOKEN_EXPIRY_DAYS));
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const name = String(new FormData(event.currentTarget).get('name'));
    const expiresInDays = expiry === NEVER ? null : (Number(expiry) as ApiTokenExpiryDays);
    const result = await settle(createApiTokenAction({ name, expiresInDays }));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setToken(result.data.token);
    router.refresh();
  }

  async function onCopy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied.');
    } catch {
      toast.error('Could not copy. Select the token and copy it by hand.');
    }
  }

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Trigger asChild>
        <Button.Root size="small">
          <Button.Icon as={IconPlus} aria-hidden="true" />
          New token
        </Button.Root>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header icon={IconKey} title="New API token" description="Acts as you, with your role, in every workspace you belong to." />
        {token ? (
          <>
            <Modal.Body className="flex flex-col gap-3">
              <TextField id="new-token" label="Your new token" value={token} readOnly onFocus={(e) => e.currentTarget.select()} />
              <p className="text-paragraph-sm text-text-sub-600">You won’t see this again. Store it somewhere safe now.</p>
            </Modal.Body>
            <Modal.Footer>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full" onClick={onCopy}>
                <Button.Icon as={IconCopy} aria-hidden="true" />
                Copy
              </Button.Root>
              <Modal.Close asChild>
                <Button.Root type="button" size="small" className="w-full">Done</Button.Root>
              </Modal.Close>
            </Modal.Footer>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <Modal.Body className="flex flex-col gap-3">
              <TextField id="token-name" label="Name" name="name" required maxLength={API_TOKEN_NAME_MAX} autoFocus placeholder="n8n, CI, CLI…" />
              <div className="flex flex-col gap-1">
                <Label.Root htmlFor="token-expiry">Expires</Label.Root>
                <Select.Root value={expiry} onValueChange={setExpiry} disabled={pending}>
                  <Select.Trigger id="token-expiry" className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {API_TOKEN_EXPIRY_DAYS.map((d) => <Select.Item key={d} value={String(d)}>In {d} days</Select.Item>)}
                    <Select.Item value={NEVER}>Never</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              {error && <FormError>{error}</FormError>}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close asChild>
                <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">Cancel</Button.Root>
              </Modal.Close>
              <Button.Root type="submit" size="small" disabled={pending} className="w-full">
                {pending ? 'Creating…' : 'Create token'}
              </Button.Root>
            </Modal.Footer>
          </form>
        )}
      </Modal.Content>
    </Modal.Root>
  );
}
