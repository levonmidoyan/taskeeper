'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/legacy-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/legacy-ui/dialog';
import { Input } from '@/components/legacy-ui/input';
import { Label } from '@/components/legacy-ui/label';
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="New project"
        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-button)] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          It starts with three columns: Todo, In Progress, and Done.
        </DialogDescription>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              name="name"
              required
              maxLength={64}
              autoFocus
              className="h-11 text-base"
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-11 w-full">
            {pending ? 'Creating…' : 'Create project'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
