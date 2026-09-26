'use client';

import { KanbanCard } from '@/components/kibo-ui/kanban';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
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
  return (
    <KanbanCard id={task.id} name={task.title} onClick={() => onOpen(task.id)}>
      <p className="text-paragraph-sm text-text-strong-950">{task.title}</p>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => <LabelChip key={label.id} name={label.name} />)}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityDot priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} />
        {task.subtaskCount > 0 && (
          <span className="tabular text-paragraph-xs text-text-sub-600">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}
        {task.assigneeName && <AssigneeAvatar name={task.assigneeName} className="ml-auto" />}
      </div>
    </KanbanCard>
  );
}
