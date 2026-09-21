'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import type { TaskRow } from '@/server/tasks/queries';

export function TaskCard({
  task,
  timezone,
  onOpen,
}: {
  task: TaskRow;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-[var(--radius-card)] border border-border bg-card p-3 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onOpen(task.id)}
        // dnd-kit puts the keyboard sensor on this button: Space lifts, arrows
        // move, Space drops, Escape cancels. A pointer-only board is unusable
        // with a keyboard, so this is required, not an enhancement (spec §6.4).
        className="w-full cursor-grab text-left active:cursor-grabbing"
      >
        <p className="text-sm text-foreground">{task.title}</p>

        {task.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.labels.map((label) => (
              <span
                key={label.id}
                className="rounded-[var(--radius-button)] bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PriorityDot priority={task.priority} />
          <DueChip dueDate={task.dueDate} timezone={timezone} />
          {task.subtaskCount > 0 && (
            <span className="tabular text-xs text-muted-foreground">
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          )}
          {task.assigneeName && (
            <span
              aria-label={`Assigned to ${task.assigneeName}`}
              className="ml-auto inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            >
              {task.assigneeName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
