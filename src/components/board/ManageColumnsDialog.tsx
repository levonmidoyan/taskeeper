'use client';

import { ArrowDown, ArrowUp, CircleCheck, Columns3, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/legacy-ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger,
} from '@/components/legacy-ui/dialog';
import { Input } from '@/components/legacy-ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/legacy-ui/select';
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
    // them. Ids, never a position: the server computes the key (spec §6.4).
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmingId(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 aria-hidden="true" />
          Columns
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Columns</DialogTitle>
        <DialogDescription>
          Rename, reorder, add, or remove this project’s columns.
        </DialogDescription>

        <ul className="space-y-2">
          {statuses.map((status, index) => {
            const others = statuses.filter((s) => s.id !== status.id);

            return (
              <li
                key={`${status.id}:${status.name}:${status.isDone}`}
                className="rounded-[var(--radius-card)] border border-border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${status.name} left`}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${status.name} right`}
                      disabled={pending || index === statuses.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </div>

                  <Input
                    // Uncontrolled and remounted by the key above, so a rename
                    // that the server rejected or normalised snaps back to what
                    // is actually stored.
                    defaultValue={status.name}
                    aria-label={`${status.name} name`}
                    maxLength={32}
                    disabled={pending}
                    className="h-9"
                    onBlur={(event) => rename(status, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        event.currentTarget.value = status.name;
                        event.currentTarget.blur();
                      }
                    }}
                  />

                  <Button
                    variant={status.isDone ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-pressed={status.isDone}
                    aria-label={`${status.name} completes tasks`}
                    title="Tasks in this column count as done"
                    disabled={pending}
                    onClick={() => toggleDone(status)}
                  >
                    <CircleCheck aria-hidden="true" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${status.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={pending || statuses.length === 1}
                    onClick={() => setConfirmingId(confirmingId === status.id ? null : status.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
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
          <Input
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            placeholder="New column name"
            aria-label="New column name"
            maxLength={32}
            disabled={pending}
            className="h-9"
          />
          <Button type="submit" size="lg" disabled={pending || !adding.trim()}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          The <CircleCheck className="inline size-3 align-[-1px]" aria-hidden="true" /> toggle marks a
          column as done: tasks dropped there are completed, and the task checkbox sends them to the
          first one.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A column holding tasks cannot simply be dropped — task.status_id is RESTRICT
 * (spec §3.2) — so the confirmation asks where its tasks should go. An empty
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
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <p className="text-xs text-muted-foreground">
        Delete <span className="font-medium text-foreground">{status.name}</span> and move any tasks
        in it to:
      </p>
      <div className="flex items-center gap-2">
        <Select value={target} onValueChange={setTarget} disabled={pending}>
          <SelectTrigger aria-label="Move tasks to" className="h-9 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {others.map((other) => (
              <SelectItem key={other.id} value={other.id}>{other.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="lg" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" size="lg" disabled={pending} onClick={() => onConfirm(target)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
