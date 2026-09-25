'use client';

import {
  IconArrowDown, IconArrowUp, IconColumns3, IconPlus, IconTrash,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Input from '@/components/ui/input';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import type { StatusRow } from '@/server/projects/queries';
import {
  createStatusAction, deleteStatusAction, moveStatusAction, updateStatusAction,
} from '@/server/statuses/actions';

/**
 * Column management for a project: rename, reorder, add, delete, and mark which
 * column counts as done. Reordering is arrow buttons rather than drag — the board
 * already owns the drag gesture for cards, and this stays usable from the
 * keyboard without a second DndContext competing for the same pointer.
 *
 * Every write is a server round-trip followed by router.refresh(): the list here
 * is the server's, never a local copy that could drift from it.
 */
export function ManageColumnsDialog({
  workspaceSlug,
  projectId,
  statuses,
  canEdit,
}: {
  workspaceSlug: string;
  projectId: string;
  statuses: StatusRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [adding, setAdding] = useState('');

  // Only owners and admins may change the board's shape, so nobody else is
  // shown a dialog full of controls the server would refuse.
  if (!canEdit) return null;

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  function rename(status: StatusRow, name: string) {
    const trimmed = name.trim();
    if (trimmed === status.name) return;
    run(() => updateStatusAction(workspaceSlug, { statusId: status.id, name: trimmed }));
  }

  function move(index: number, direction: -1 | 1) {
    const status = statuses[index];
    // The two neighbours the column lands between once it has moved past one of
    // them. Ids, never a position: the server computes the key (v1 spec §6.4).
    const [beforeId, afterId] = direction === -1
      ? [statuses[index - 2]?.id ?? null, statuses[index - 1].id]
      : [statuses[index + 1].id, statuses[index + 2]?.id ?? null];

    run(() => moveStatusAction(workspaceSlug, { statusId: status.id, beforeId, afterId }));
  }

  function toggleDone(status: StatusRow) {
    run(
      () => updateStatusAction(workspaceSlug, { statusId: status.id, isDone: !status.isDone }),
      status.isDone ? `${status.name} no longer completes tasks.` : `${status.name} now completes tasks.`,
    );
  }

  function remove(status: StatusRow, reassignToId: string | null) {
    run(
      async () => {
        const result = await deleteStatusAction(workspaceSlug, { statusId: status.id, reassignToId });
        if (result.ok) setConfirmingId(null);
        return result;
      },
      `Deleted ${status.name}.`,
    );
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = adding.trim();
    if (!name) return;
    run(
      async () => {
        const result = await createStatusAction(workspaceSlug, { projectId, name });
        if (result.ok) setAdding('');
        return result;
      },
      `Added ${name}.`,
    );
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmingId(null);
      }}
    >
      <Modal.Trigger asChild>
        <Button.Root variant="neutral" mode="stroke" size="xsmall">
          <Button.Icon as={IconColumns3} />
          Columns
        </Button.Root>
      </Modal.Trigger>
      <Modal.Content className="max-w-lg">
        <Modal.Header
          icon={IconColumns3}
          title="Columns"
          description="Rename, reorder, add, or remove this project's columns."
        />

        <Modal.Body className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {statuses.map((status, index) => {
              const others = statuses.filter((s) => s.id !== status.id);

              return (
                <li
                  key={`${status.id}:${status.name}:${status.isDone}`}
                  className="rounded-10 p-2 ring-1 ring-inset ring-stroke-soft-200"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <CompactButton.Root
                        variant="ghost"
                        size="medium"
                        aria-label={`Move ${status.name} left`}
                        disabled={pending || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <CompactButton.Icon as={IconArrowUp} />
                      </CompactButton.Root>
                      <CompactButton.Root
                        variant="ghost"
                        size="medium"
                        aria-label={`Move ${status.name} right`}
                        disabled={pending || index === statuses.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <CompactButton.Icon as={IconArrowDown} />
                      </CompactButton.Root>
                    </div>

                    <Input.Root size="small" className="flex-1">
                      <Input.Wrapper>
                        <Input.Input
                          // Uncontrolled and remounted by the key above, so a rename
                          // that the server rejected or normalised snaps back to what
                          // is actually stored.
                          defaultValue={status.name}
                          aria-label={`${status.name} name`}
                          maxLength={32}
                          disabled={pending}
                          onBlur={(event) => rename(status, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                              event.currentTarget.value = status.name;
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </Input.Wrapper>
                    </Input.Root>

                    <span className="flex items-center gap-1.5 pl-1" title="Tasks in this column count as done">
                      <Switch.Root
                        checked={status.isDone}
                        onCheckedChange={() => toggleDone(status)}
                        disabled={pending}
                        aria-label={`${status.name} completes tasks`}
                      />
                      <span aria-hidden="true" className="text-paragraph-xs text-text-sub-600">
                        Done
                      </span>
                    </span>

                    <CompactButton.Root
                      variant="ghost"
                      size="medium"
                      aria-label={`Delete ${status.name}`}
                      className="hover:text-error-base"
                      disabled={pending || statuses.length === 1}
                      onClick={() => setConfirmingId(confirmingId === status.id ? null : status.id)}
                    >
                      <CompactButton.Icon as={IconTrash} />
                    </CompactButton.Root>
                  </div>

                  {confirmingId === status.id && others.length > 0 && (
                    <DeleteColumnConfirm
                      status={status}
                      others={others}
                      pending={pending}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={(reassignToId) => remove(status, reassignToId)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          <form onSubmit={add} className="flex items-center gap-2">
            <Input.Root size="small" className="flex-1">
              <Input.Wrapper>
                <Input.Input
                  value={adding}
                  onChange={(event) => setAdding(event.target.value)}
                  placeholder="New column name"
                  aria-label="New column name"
                  maxLength={32}
                  disabled={pending}
                />
              </Input.Wrapper>
            </Input.Root>
            <Button.Root type="submit" size="small" disabled={pending || !adding.trim()}>
              <Button.Icon as={IconPlus} />
              Add
            </Button.Root>
          </form>

          <p className="text-paragraph-xs text-text-sub-600">
            A column switched to Done completes the tasks dropped into it, and a task&apos;s done
            toggle sends it to the first such column.
          </p>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

/**
 * A column holding tasks cannot simply be dropped — task.status_id is RESTRICT
 * (v1 spec §3.2) — so the confirmation asks where its tasks should go. An empty
 * column ignores the answer, which is why the target is offered rather than
 * demanded: the client never needs to know the count.
 */
function DeleteColumnConfirm({
  status,
  others,
  pending,
  onCancel,
  onConfirm,
}: {
  status: StatusRow;
  others: StatusRow[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reassignToId: string) => void;
}) {
  const [target, setTarget] = useState(others[0].id);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-stroke-soft-200 pt-2">
      <p className="text-paragraph-xs text-text-sub-600">
        Delete <span className="text-label-xs text-text-strong-950">{status.name}</span> and move any
        tasks in it to:
      </p>
      <div className="flex items-center gap-2">
        <Select.Root size="small" value={target} onValueChange={setTarget} disabled={pending}>
          <Select.Trigger aria-label="Move tasks to" className="flex-1">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {others.map((other) => <Select.Item key={other.id} value={other.id}>{other.name}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Button.Root variant="neutral" mode="ghost" size="xsmall" disabled={pending} onClick={onCancel}>
          Cancel
        </Button.Root>
        <Button.Root variant="error" size="xsmall" disabled={pending} onClick={() => onConfirm(target)}>
          Delete
        </Button.Root>
      </div>
    </div>
  );
}
