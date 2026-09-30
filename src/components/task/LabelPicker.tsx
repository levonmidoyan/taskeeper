'use client';

import { IconPlus, IconTag, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { LabelChip } from '@/components/task/LabelChip';
import * as Input from '@/components/ui/input';
import * as Popover from '@/components/ui/popover';
import { settle } from '@/lib/settle';
import { createLabelAction, deleteLabelAction, setTaskLabelsAction } from '@/server/labels/actions';
import type { LabelRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

/** Attaches labels to an existing task, saving each change as it is made. */
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
  // The server's list only catches up after router.refresh(), so a second pick
  // before then would be built from the old list and drop the first. Picks go
  // to this local copy, which follows the server whenever the server changes.
  const serverIds = selected.map((l) => l.id);
  const [ids, setIds] = useState(serverIds);
  const [synced, setSynced] = useState(serverIds.join());
  if (synced !== serverIds.join()) {
    setSynced(serverIds.join());
    setIds(serverIds);
  }

  function apply(labelIds: string[]) {
    setIds(labelIds);
    startTransition(async () => {
      const result = await settle(setTaskLabelsAction(workspaceSlug, { taskId, labelIds }));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <LabelSelect
      workspaceSlug={workspaceSlug}
      allLabels={allLabels}
      value={ids}
      onChange={apply}
      onLabelDeleted={() => router.refresh()}
    />
  );
}


/**
 * The label field on its own: picks ids and leaves saving them to the caller,
 * so the create form can use it before the task exists. Creating and deleting
 * labels themselves still happens here, workspace-wide.
 *
 * An input with an inline add button, matching labels suggested below it while
 * it has focus, and the chosen labels as removable tags underneath.
 */
export function LabelSelect({
  workspaceSlug,
  allLabels,
  value,
  onChange,
  onLabelDeleted,
}: {
  workspaceSlug: string;
  allLabels: LabelRow[];
  value: string[];
  onChange: (labelIds: string[]) => void;
  onLabelDeleted?: (labelId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const inputId = useId();
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Labels made from this field, shown until the caller's list catches up.
  const [created, setCreated] = useState<LabelRow[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  // attach/remove also run after an await (creating or deleting a label), by
  // which time `value` in this render's closure may be out of date.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const labels = [...allLabels, ...created.filter((c) => !allLabels.some((l) => l.id === c.id))]
    .filter((l) => !deleted.includes(l.id));
  const selectedIds = new Set(value);
  const selected = labels.filter((l) => selectedIds.has(l.id));
  const query = draft.trim().toLowerCase();
  const suggestions = labels.filter((l) => !selectedIds.has(l.id) && l.name.toLowerCase().includes(query));
  const showList = open && suggestions.length > 0;

  function attach(labelId: string) {
    // A Set: typing the name of a label already selected returns that same
    // id, and sending it twice is not a selection change.
    latest.current = [...new Set([...latest.current, labelId])];
    onChange(latest.current);
    setDraft('');
    setActive(-1);
  }

  function remove(labelId: string) {
    latest.current = latest.current.filter((id) => id !== labelId);
    onChange(latest.current);
  }

  function add() {
    const name = draft.trim();
    if (!name) {
      inputRef.current?.focus();
      return;
    }

    startTransition(async () => {
      // Creating an existing name returns that label, so typing a duplicate
      // simply attaches it.
      const result = await settle(createLabelAction(workspaceSlug, { name }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCreated((prev) => [...prev, result.data]);
      attach(result.data.id);
    });
  }

  function onDelete(labelId: string) {
    startTransition(async () => {
      const result = await settle(deleteLabelAction(workspaceSlug, { labelId }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDeleted((prev) => [...prev, labelId]);
      if (latest.current.includes(labelId)) remove(labelId);
      onLabelDeleted?.(labelId);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = showList ? suggestions[active] : undefined;
      if (pick) attach(pick.id);
      else add();
    } else if (event.key === 'Escape' && showList) {
      // Close the list only; the surrounding dialog stays open.
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Popover.Root open={showList} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <div ref={anchorRef}>
            <label htmlFor={inputId} className="sr-only">Add labels</label>
            <Input.Root size="small">
              <Input.Wrapper className="pr-1.5">
                <Input.Input
                  ref={inputRef}
                  id={inputId}
                  role="combobox"
                  aria-expanded={showList}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
                  autoComplete="off"
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setOpen(true); setActive(-1); }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={onKeyDown}
                  maxLength={32}
                  placeholder="Add labels..."
                />
                <button
                  type="button"
                  aria-label="Add label"
                  disabled={isPending}
                  onClick={add}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bg-white-0 text-text-soft-400 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 transition duration-200 ease-out hover:bg-bg-weak-50 hover:text-text-sub-600 hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base disabled:opacity-50"
                >
                  <IconPlus className="size-4" aria-hidden="true" />
                </button>
              </Input.Wrapper>
            </Input.Root>
          </div>
        </Popover.Anchor>

        <Popover.Content
          align="start"
          sideOffset={6}
          showArrow={false}
          // Focus stays in the input while the list is open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="w-[var(--radix-popover-trigger-width)] rounded-xl p-1"
        >
          <ul id={listId} role="listbox" aria-label="Labels" className="max-h-56 overflow-y-auto">
            {suggestions.map((label, index) => (
              <li
                key={label.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep focus in the input so typing can carry on.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => attach(label.id)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-lg py-1.5 pl-2 pr-1 text-paragraph-sm text-text-strong-950',
                  index === active && 'bg-bg-weak-50',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <IconTag className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
                  <span className="truncate">{label.name}</span>
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Delete label ${label.name}`}
                  onClick={(event) => { event.stopPropagation(); onDelete(label.id); }}
                  className="rounded-md p-1 text-text-soft-400 transition-colors duration-150 hover:text-error-base"
                >
                  <IconTrash className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Root>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((l) => <LabelChip key={l.id} name={l.name} onRemove={() => remove(l.id)} />)}
        </div>
      )}
    </div>
  );
}
