'use client';

import { Check, Tag, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/legacy-ui/dropdown-menu';
import { Input } from '@/components/legacy-ui/input';
import { createLabelAction, deleteLabelAction, setTaskLabelsAction } from '@/server/labels/actions';
import type { LabelRow } from '@/server/tasks/queries';

export function LabelPicker({
  workspaceSlug,
  taskId,
  allLabels,
  selected,
}: {
  workspaceSlug: string;
  taskId: string;
  allLabels: LabelRow[];
  selected: LabelRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const selectedIds = new Set(selected.map((l) => l.id));

  function apply(labelIds: string[]) {
    startTransition(async () => {
      const result = await setTaskLabelsAction(workspaceSlug, { taskId, labelIds });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function toggle(labelId: string) {
    const next = selectedIds.has(labelId)
      ? [...selectedIds].filter((id) => id !== labelId)
      : [...new Set([...selectedIds, labelId])];
    apply(next);
  }

  function onCreate(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const name = draft.trim();
    if (!name) return;

    startTransition(async () => {
      // Creating an existing name returns that label, so typing a duplicate
      // simply attaches it.
      const created = await createLabelAction(workspaceSlug, { name });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      setDraft('');
      // A Set: typing the name of a label the task already carries returns that
      // same id, and sending it twice is not a selection change.
      apply([...new Set([...selectedIds, created.data.id])]);
    });
  }

  function onDelete(labelId: string) {
    startTransition(async () => {
      const result = await deleteLabelAction(workspaceSlug, { labelId });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
        <Tag className="size-4" aria-hidden="true" />
        {selected.length > 0 ? selected.map((l) => l.name).join(', ') : 'Add labels'}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <div className="p-2">
          <label htmlFor="new-label" className="sr-only">New label name</label>
          <Input
            id="new-label"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onCreate}
            maxLength={32}
            placeholder="Type a name, press Enter"
            className="h-9 text-base lg:text-sm"
          />
        </div>

        {allLabels.length > 0 && <DropdownMenuSeparator />}

        {allLabels.map((label) => (
          <DropdownMenuItem
            key={label.id}
            onSelect={(event) => { event.preventDefault(); toggle(label.id); }}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <Check
                className={`size-4 ${selectedIds.has(label.id) ? 'opacity-100' : 'opacity-0'}`}
                aria-hidden="true"
              />
              {label.name}
            </span>
            <button
              type="button"
              aria-label={`Delete label ${label.name}`}
              onClick={(event) => { event.stopPropagation(); onDelete(label.id); }}
              className="text-muted-foreground transition-colors duration-150 hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
