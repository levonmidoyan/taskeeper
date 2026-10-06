'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { projectDot } from '@/components/brand/tint';
import * as Button from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatInZone } from '@/lib/dates';
import { settle } from '@/lib/settle';
import type { ArchivedProject } from '@/server/projects/queries';
import { deleteProjectAction, unarchiveProjectAction } from '@/server/projects/actions';
import { cn } from '@/utils/cn';

/** Archived projects with Restore and Delete; members see the list without the buttons. */
export function ArchivedProjectList({
  projects,
  workspaceSlug,
  timezone,
  canManage,
}: {
  projects: ArchivedProject[];
  workspaceSlug: string;
  timezone: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  function onRestore(project: ArchivedProject) {
    startTransition(async () => {
      const result = await settle(unarchiveProjectAction(workspaceSlug, { projectId: project.id }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`“${project.name}” restored.`, {
        action: { label: 'Open', onClick: () => router.push(`/${workspaceSlug}/projects/${project.id}`) },
      });
    });
  }

  async function onDelete(project: ArchivedProject) {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      description: 'Its tasks, comments and files are deleted for everyone. This cannot be undone.',
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await settle(deleteProjectAction(workspaceSlug, { projectId: project.id }));
      if (!result.ok) toast.error(result.error);
      else toast.success(`“${project.name}” deleted.`);
    });
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-2xl px-4 py-6 text-center text-paragraph-sm text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200">
        No archived projects.
      </p>
    );
  }

  return (
    <ul
      aria-label="Archived projects"
      className="divide-y divide-stroke-soft-200 rounded-2xl ring-1 ring-inset ring-stroke-soft-200"
    >
      {projects.map((project) => (
        <li key={project.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', projectDot(project))} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label-sm text-text-strong-950">{project.name}</p>
            <p className="text-paragraph-xs text-text-sub-600">
              Archived {formatInZone(project.archivedAt, timezone)}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2 max-sm:basis-full max-sm:pl-5.5">
              <Button.Root
                type="button"
                variant="neutral"
                mode="stroke"
                size="xsmall"
                onClick={() => onRestore(project)}
                disabled={pending}
                aria-label={`Restore ${project.name}`}
              >
                Restore
              </Button.Root>
              <Button.Root
                type="button"
                variant="error"
                mode="ghost"
                size="xsmall"
                onClick={() => void onDelete(project)}
                disabled={pending}
                aria-label={`Delete ${project.name}`}
              >
                Delete
              </Button.Root>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
