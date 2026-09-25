'use client';

import { IconCheck, IconTag, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { LabelChip } from '@/components/task/LabelChip';
import * as Dropdown from '@/components/ui/dropdown';
import * as Input from '@/components/ui/input';
import { createLabelAction, deleteLabelAction, setTaskLabelsAction } from '@/server/labels/actions';
import type { LabelRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

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
    <Dropdown.Root>
      <Dropdown.Trigger className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-paragraph-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950 data-[state=open]:bg-bg-weak-50">
        <IconTag className="size-4 shrink-0" aria-hidden="true" />
        {selected.length > 0
          ? <span className="flex flex-wrap gap-1">{selected.map((l) => <LabelChip key={l.id} name={l.name} />)}</span>
          : 'Add labels'}
      </Dropdown.Trigger>

      <Dropdown.Content align="start" className="w-64">
        <div className="p-1">
          <label htmlFor="new-label" className="sr-only">New label name</label>
          <Input.Root size="small">
            <Input.Wrapper>
              <Input.Input
                id="new-label"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(event) => {
                  // Radix menus treat printable keys as typeahead and move focus to a
                  // matching item; keep them in the field. Escape still closes the menu.
                  if (event.key !== 'Escape') event.stopPropagation();
                  onCreate(event);
                }}
                maxLength={32}
                placeholder="Type a name, press Enter"
              />
            </Input.Wrapper>
          </Input.Root>
        </div>

        {allLabels.length > 0 && <Dropdown.Separator />}

        {allLabels.map((label) => (
          <Dropdown.Item
            key={label.id}
            onSelect={(event) => { event.preventDefault(); toggle(label.id); }}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <IconCheck
                className={cn('size-4', selectedIds.has(label.id) ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
              {label.name}
            </span>
            <button
              type="button"
              aria-label={`Delete label ${label.name}`}
              onClick={(event) => { event.stopPropagation(); onDelete(label.id); }}
              className="rounded-md p-1 text-text-soft-400 transition-colors duration-150 hover:text-error-base"
            >
              <IconTrash className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
