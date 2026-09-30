'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconColumns3, IconGripVertical, IconPlus, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { StatusIconPicker } from '@/components/board/StatusIconPicker';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Input from '@/components/ui/input';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import { settle } from '@/lib/settle';
import type { StatusRow } from '@/server/projects/queries';
import {
  createStatusAction, deleteStatusAction, moveStatusAction, updateStatusAction,
} from '@/server/statuses/actions';
import { cn } from '@/utils/cn';

/**
 * Column management for a project: rename, reorder, add, delete, and mark which
 * column counts as done. Rows reorder by dragging their grip handle (Space on a
 * focused handle for the keyboard). The dialog is modal, so its DndContext never
 * competes with the board's for the same pointer.
 *
 * Every write is a server round-trip followed by router.refresh(): the list here
 * is the server's, with only a dropped row's new place held optimistically until
 * the refresh lands.
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
  const [dragging, setDragging] = useState(false);
  const [ordered, applyOrder] = useOptimistic(statuses, (_current: StatusRow[], next: StatusRow[]) => next);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    run(() => settle(updateStatusAction(workspaceSlug, { statusId: status.id, name: trimmed })));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((s) => s.id === active.id);
    const to = ordered.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;

    const next = arrayMove(ordered, from, to);
    // The two neighbours the column now sits between. Ids, never a position: the
    // server computes the key (v1 spec §6.4).
    const beforeId = next[to - 1]?.id ?? null;
    const afterId = next[to + 1]?.id ?? null;

    startTransition(async () => {
      applyOrder(next);
      const result = await settle(moveStatusAction(workspaceSlug, { statusId: String(active.id), beforeId, afterId }));
      if (!result.ok) toast.error(result.error ?? 'Something went wrong. Please try again.');
      router.refresh();
    });
  }

  function toggleDone(status: StatusRow) {
    run(
      () => settle(updateStatusAction(workspaceSlug, { statusId: status.id, isDone: !status.isDone })),
      status.isDone ? `${status.name} no longer completes tasks.` : `${status.name} now completes tasks.`,
    );
  }

  function remove(status: StatusRow, reassignToId: string | null) {
    run(
      async () => {
        const result = await settle(deleteStatusAction(workspaceSlug, { statusId: status.id, reassignToId }));
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
        const result = await settle(createStatusAction(workspaceSlug, { projectId, name }));
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
      <Modal.Content
        className="max-w-lg"
        // Escape mid-drag cancels the drag; it must not also close the dialog.
        onEscapeKeyDown={(event) => { if (dragging) event.preventDefault(); }}
      >
        <Modal.Header
          icon={IconColumns3}
          title="Columns"
          description="Rename, reorder, restyle, add, or remove this project's columns."
        />

        <Modal.Body className="flex flex-col gap-3">
          <DndContext
            // An explicit id, like the board's: dnd-kit's counter-based ids differ
            // between server and browser.
            id="manage-columns"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(false)}
          >
            <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2">
                {ordered.map((status) => (
                  <ColumnRow
                    workspaceSlug={workspaceSlug}
                    key={`${status.id}:${status.name}:${status.isDone}:${status.icon}`}
                    status={status}
                    others={ordered.filter((s) => s.id !== status.id)}
                    pending={pending}
                    confirming={confirmingId === status.id}
                    onToggleConfirm={() => setConfirmingId(confirmingId === status.id ? null : status.id)}
                    onRename={(name) => rename(status, name)}
                    onToggleDone={() => toggleDone(status)}
                    onRemove={(reassignToId) => remove(status, reassignToId)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

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

function ColumnRow({
  workspaceSlug,
  status,
  others,
  pending,
  confirming,
  onToggleConfirm,
  onRename,
  onToggleDone,
  onRemove,
}: {
  workspaceSlug: string;
  status: StatusRow;
  others: StatusRow[];
  pending: boolean;
  confirming: boolean;
  onToggleConfirm: () => void;
  onRename: (name: string) => void;
  onToggleDone: () => void;
  onRemove: (reassignToId: string) => void;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: status.id, disabled: pending });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative rounded-10 bg-bg-white-0 p-2 ring-1 ring-inset ring-stroke-soft-200',
        isDragging && 'z-10 shadow-regular-md ring-primary-base',
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${status.name}`}
          disabled={pending}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-soft-400 hover:text-text-sub-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="size-[18px]" aria-hidden="true" />
        </button>

        <StatusIconPicker workspaceSlug={workspaceSlug} status={status} disabled={pending} />

        <Input.Root size="small" className="flex-1">
          <Input.Wrapper>
            <Input.Input
              // Uncontrolled and remounted by the row key, so a rename that the
              // server rejected or normalised snaps back to what is actually stored.
              defaultValue={status.name}
              aria-label={`${status.name} name`}
              maxLength={32}
              disabled={pending}
              onBlur={(event) => onRename(event.currentTarget.value)}
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
            onCheckedChange={onToggleDone}
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
          disabled={pending || others.length === 0}
          onClick={onToggleConfirm}
        >
          <CompactButton.Icon as={IconTrash} />
        </CompactButton.Root>
      </div>

      {confirming && others.length > 0 && (
        <DeleteColumnConfirm
          status={status}
          others={others}
          pending={pending}
          onCancel={onToggleConfirm}
          onConfirm={onRemove}
        />
      )}
    </li>
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
