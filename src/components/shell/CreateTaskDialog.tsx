'use client';

import { IconPlus, IconSquareRoundedPlus } from '@tabler/icons-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Label from '@/components/ui/label';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import type { ProjectSummary } from '@/server/projects/queries';
import { createTaskAction } from '@/server/tasks/actions';

/**
 * The header's Create button. Defaults to the project on screen, lands in the
 * leftmost column, then opens the new task's detail dialog so the rest can be
 * filled in there. "c" opens it from anywhere, as in Jira.
 */
export function CreateTaskDialog({
  workspaceSlug,
  projects,
}: {
  workspaceSlug: string;
  projects: ProjectSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const disabled = projects.length === 0;

  function onOpenChange(next: boolean) {
    if (next) {
      const current = projects.find((p) => p.id === params.projectId);
      setProjectId((current ?? projects[0])?.id);
      setError(null);
    }
    setOpen(next);
  }

  useEffect(() => {
    if (disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'c' || ignoreShortcut(e)) return;
      e.preventDefault();
      onOpenChange(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setPending(true);
    setError(null);

    const title = String(new FormData(event.currentTarget).get('title')).trim();
    const result = await createTaskAction(workspaceSlug, { projectId, title });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    // Stay on the board if that is the view already showing this project.
    const projectPath = `/${workspaceSlug}/projects/${projectId}`;
    const base = pathname.startsWith(projectPath) ? pathname : projectPath;
    router.push(`${base}?task=${result.data.id}`);
  }

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Trigger asChild>
        <Button.Root
          size="small"
          disabled={disabled}
          title={disabled ? 'Create a project first' : 'Create task (C)'}
          aria-label="Create task"
          className="shrink-0 max-sm:w-9 max-sm:px-0"
        >
          <Button.Icon as={IconPlus} />
          <span className="max-sm:sr-only">Create</span>
        </Button.Root>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header
          icon={IconSquareRoundedPlus}
          title="New task"
          description="It lands in the project's first column."
        />
        <form onSubmit={onSubmit}>
          <Modal.Body className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label.Root htmlFor="create-task-project">Project</Label.Root>
              <Select.Root value={projectId} onValueChange={setProjectId}>
                <Select.Trigger id="create-task-project"><Select.Value /></Select.Trigger>
                <Select.Content>
                  {projects.map((p) => <Select.Item key={p.id} value={p.id}>{p.name}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
            <TextField id="create-task-title" label="Title" name="title" required maxLength={200} autoFocus />
            {error && <FormError>{error}</FormError>}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">
                Cancel
              </Button.Root>
            </Modal.Close>
            <Button.Root type="submit" size="small" disabled={pending || !projectId} className="w-full">
              {pending ? 'Creating…' : 'Create task'}
            </Button.Root>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
