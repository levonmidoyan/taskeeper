'use client';

import type { BoardItem } from '@/components/board/Board';
import { columnId } from '@/components/board/neighbours';
import { TaskCard } from '@/components/board/TaskCard';
import { KanbanBoard, KanbanCards, KanbanHeader } from '@/components/kibo-ui/kanban';
import { QuickAddTask } from '@/components/task/QuickAddTask';
import type { StatusRow } from '@/server/projects/queries';

export function BoardColumn({
  status,
  count,
  workspaceSlug,
  projectId,
  timezone,
  onOpen,
}: {
  status: StatusRow;
  count: number;
  workspaceSlug: string;
  projectId: string;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const id = columnId(status.id);

  return (
    <KanbanBoard id={id} aria-label={status.name} className="w-[280px] shrink-0">
      <KanbanHeader>
        <h2 className="flex items-center gap-2 text-label-sm text-text-strong-950">
          {status.name}
          <span className="tabular text-paragraph-xs text-text-soft-400">{count}</span>
        </h2>
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
