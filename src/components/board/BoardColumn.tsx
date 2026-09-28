'use client';

import { IconPencil } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { BoardItem } from '@/components/board/Board';
import { columnId } from '@/components/board/neighbours';
import { StatusIconPicker } from '@/components/board/StatusIconPicker';
import { TaskCard } from '@/components/board/TaskCard';
import { KanbanBoard, KanbanCards, KanbanHeader } from '@/components/kibo-ui/kanban';
import { QuickAddTask } from '@/components/task/QuickAddTask';
import { StatusIcon } from '@/components/task/StatusIcon';
import * as CompactButton from '@/components/ui/compact-button';
import type { StatusRow } from '@/server/projects/queries';
import { updateStatusAction } from '@/server/statuses/actions';

export function BoardColumn({
  status,
  count,
  workspaceSlug,
  projectId,
  timezone,
  canEdit,
  onOpen,
}: {
  status: StatusRow;
  count: number;
  workspaceSlug: string;
  projectId: string;
  timezone: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const id = columnId(status.id);

  return (
    <KanbanBoard id={id} aria-label={status.name} className="w-[280px] shrink-0">
      <KanbanHeader className="group/header flex items-center gap-2">
        {canEdit
          ? <StatusIconPicker workspaceSlug={workspaceSlug} status={status} />
          : <StatusIcon status={status} />}
        <ColumnName
          // Remounted on a rename so the field starts from what the server stored.
          key={status.name}
          status={status}
          workspaceSlug={workspaceSlug}
          canEdit={canEdit}
        />
        <span className="tabular text-paragraph-xs text-text-soft-400">{count}</span>
      </KanbanHeader>

      <KanbanCards<BoardItem>
        id={id}
        empty={
          <li className="rounded-10 border border-dashed border-stroke-sub-300 px-3 py-6 text-center text-paragraph-xs text-text-soft-400">
            Drop a task here
          </li>
        }
      >
        {(item) => <TaskCard key={item.id} task={item.task} timezone={timezone} onOpen={onOpen} />}
      </KanbanCards>

      <div className="border-t border-stroke-soft-200 px-3">
        <QuickAddTask
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statusId={status.id}
          placeholder={`Add to ${status.name}…`}
        />
      </div>
    </KanbanBoard>
  );
}

/**
 * The column title, renamed in place behind a pencil for owners and admins. The
 * pencil only shows on hover or focus so the header stays quiet; Enter or blur
 * saves, Escape discards.
 */
function ColumnName({
  status,
  workspaceSlug,
  canEdit,
}: {
  status: StatusRow;
  workspaceSlug: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(value: string) {
    setEditing(false);
    const name = value.trim();
    if (!name || name === status.name) return;
    startTransition(async () => {
      const result = await updateStatusAction(workspaceSlug, { statusId: status.id, name });
      if (!result.ok) toast.error(result.error ?? 'Something went wrong. Please try again.');
      router.refresh();
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={status.name}
        aria-label={`Rename ${status.name}`}
        maxLength={32}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => save(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = status.name;
            event.currentTarget.blur();
          }
        }}
        className="h-6 min-w-0 flex-1 rounded-md bg-bg-white-0 px-1.5 text-label-sm text-text-strong-950 outline-none ring-1 ring-inset ring-primary-base"
      />
    );
  }

  return (
    <>
      <h2 className="min-w-0 truncate text-label-sm text-text-strong-950">{status.name}</h2>
      {canEdit && (
        <CompactButton.Root
          variant="ghost"
          size="medium"
          aria-label={`Rename ${status.name}`}
          disabled={pending}
          onClick={() => setEditing(true)}
          className="order-last ml-auto opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100"
        >
          <CompactButton.Icon as={IconPencil} />
        </CompactButton.Root>
      )}
    </>
  );
}
