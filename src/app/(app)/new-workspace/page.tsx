'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/auth/ui/card';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import { createWorkspaceAction } from '@/server/workspaces/actions';

export default function NewWorkspacePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await createWorkspaceAction({ name });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/${result.data.slug}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-weak-50 px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Create a workspace</CardTitle>
            <CardDescription>A workspace holds your projects and your team.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <TextField id="name" label="Workspace name" name="name" required maxLength={64} autoFocus />
              {error && <FormError>{error}</FormError>}
              <Button.Root type="submit" disabled={pending} className="w-full">
                {pending ? 'Creating…' : 'Create workspace'}
              </Button.Root>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
