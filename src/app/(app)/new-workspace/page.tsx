'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/legacy-ui/button';
import { Input } from '@/components/legacy-ui/input';
import { Label } from '@/components/legacy-ui/label';
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
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-[var(--radius-panel)] border border-border bg-card p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Create a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace holds your projects and your team.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Workspace name</Label>
          <Input id="name" name="name" required maxLength={64} autoFocus className="h-11 text-base" />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </main>
  );
}
