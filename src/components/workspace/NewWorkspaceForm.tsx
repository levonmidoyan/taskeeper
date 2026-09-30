'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { settle } from '@/lib/settle';
import { createWorkspaceAction } from '@/server/workspaces/actions';

export function NewWorkspaceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await settle(createWorkspaceAction({ name }));

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/${result.data.slug}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <TextField id="name" label="Workspace name" name="name" required maxLength={64} autoFocus />
      {error && <FormError>{error}</FormError>}
      <Button.Root type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating…' : 'Create workspace'}
      </Button.Root>
    </form>
  );
}
