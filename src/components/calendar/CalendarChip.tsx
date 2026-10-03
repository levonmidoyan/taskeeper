'use client';

import { useDraggable } from '@dnd-kit/core';
import { projectDot } from '@/components/brand/tint';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { StatusIcon } from '@/components/task/StatusIcon';
import type { CalendarTask } from '@/server/tasks/calendar';
import { cn } from '@/utils/cn';

/**
 * One task on the calendar: a button (Enter/click opens it) that dnd-kit can
 * lift (mouse drag past 8px, long press, or Space). Done tasks are struck
 * through; overdue ones are tinted.
 */
export function CalendarChip({
  task,
  today,
  showProject,
  onOpen,
}: {
  task: CalendarTask;
  today: string;
  showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { day: task.dueDate, title: task.title },
  });
  const overdue = !task.isDone && task.dueDate < today;

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      aria-label={`${task.title}${task.isDone ? ', done' : overdue ? ', overdue' : ''}`}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-paragraph-xs ring-1 ring-inset',
        'bg-bg-white-0 ring-stroke-soft-200 hover:bg-bg-weak-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
        overdue && 'bg-error-lighter ring-error-light',
        isDragging && 'relative z-20 shadow-regular-md',
      )}
    >
      {showProject ? (
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', projectDot({ id: task.projectId, color: task.projectColor }))} />
      ) : (
        <StatusIcon status={{ color: task.statusColor, isDone: task.isDone, icon: task.statusIcon }} className="size-3.5 shrink-0" />
      )}
      <span className={cn('min-w-0 flex-1 truncate', task.isDone ? 'text-text-soft-400 line-through' : 'text-text-strong-950')}>
        {task.title}
      </span>
      {task.assigneeName && (
        <AssigneeAvatar name={task.assigneeName} image={task.assigneeImage} className="size-4 text-[0.5rem]" />
      )}
    </button>
  );
}
