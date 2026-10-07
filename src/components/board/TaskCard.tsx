'use client';

import { KanbanCard } from '@/components/kibo-ui/kanban';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityChip } from '@/components/task/Priority';
import { cardTransitionName, taskMorphName } from '@/lib/motion';
import type { TaskRow } from '@/server/tasks/queries';

export function TaskCard({
  task,
  timezone,
  openTaskId,
  onOpen,
}: {
  task: TaskRow;
  timezone: string;
  openTaskId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <KanbanCard
      id={task.id}
      name={task.title}
      onClick={() => onOpen(task.id)}
      transitionName={cardTransitionName(task.id)}
      morphName={taskMorphName(task.id, openTaskId)}
    >
      <p className="text-paragraph-sm text-text-strong-950">{task.title}</p>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => <LabelChip key={label.id} name={label.name} />)}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityChip priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} done={task.completedAt !== null} />
        {task.subtaskCount > 0 && (
          <span className="tabular text-paragraph-xs text-text-sub-600">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}
        {task.assigneeName && <AssigneeAvatar name={task.assigneeName} image={task.assigneeImage} className="ml-auto" />}
      </div>
    </KanbanCard>
  );
}
