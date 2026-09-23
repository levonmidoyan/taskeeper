'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from '@/components/board/TaskCard';
import { QuickAddTask } from '@/components/task/QuickAddTask';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow } from '@/server/tasks/queries';

export function BoardColumn({
  status,
  tasks,
  workspaceSlug,
  projectId,
  timezone,
  onOpen,
}: {
  status: StatusRow;
  tasks: TaskRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status.id}` });

  return (
    <section
      aria-label={status.name}
      className="flex w-[280px] shrink-0 flex-col rounded-[var(--radius-panel)] bg-muted/50"
    >
      <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground">
        {status.name}
        <span className="tabular text-xs font-normal text-muted-foreground">{tasks.length}</span>
      </h2>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 ${
            isOver ? 'rounded-[var(--radius-panel)] ring-2 ring-ring' : ''
          }`}
        >
          {tasks.length === 0 && (
            <li className="rounded-[var(--radius-card)] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Drop a task here
            </li>
          )}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} timezone={timezone} onOpen={onOpen} />
          ))}
        </ul>
      </SortableContext>

      <div className="border-t border-border px-3">
        <QuickAddTask
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statusId={status.id}
          placeholder={`Add to ${status.name}…`}
        />
      </div>
    </section>
  );
}
