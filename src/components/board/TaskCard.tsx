'use client';

import { IconArrowsRightLeft } from '@tabler/icons-react';
import { CardSubtasks } from '@/components/board/CardSubtasks';
import { KanbanCard } from '@/components/kibo-ui/kanban';
import { Hint } from '@/components/shell/ShortcutHint';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { LabelChip } from '@/components/task/LabelChip';
import { PriorityChip } from '@/components/task/Priority';
import { StatusIcon } from '@/components/task/StatusIcon';
import * as CompactButton from '@/components/ui/compact-button';
import * as Dropdown from '@/components/ui/dropdown';
import { cardTransitionName, taskMorphName } from '@/lib/motion';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow } from '@/server/tasks/queries';

export function TaskCard({
  task,
  timezone,
  openTaskId,
  onOpen,
  statuses,
  onMoveTo,
  workspaceSlug,
  expanded,
  onToggleSubtasks,
}: {
  task: TaskRow;
  timezone: string;
  openTaskId: string | null;
  onOpen: (id: string) => void;
  statuses: StatusRow[];
  onMoveTo: (taskId: string, statusId: string) => void;
  workspaceSlug: string;
  expanded: boolean;
  onToggleSubtasks: (id: string) => void;
}) {
  // Move to… without a drag: a long press is hard to find on a phone, and impossible
  // to aim across columns that don't fit on its screen.
  const moveMenu = (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Hint label="Move to…">
          <CompactButton.Root
            variant="ghost"
            size="medium"
            aria-label={`Move ${task.title}`}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100 max-sm:size-11"
          >
            <CompactButton.Icon as={IconArrowsRightLeft} />
          </CompactButton.Root>
        </Hint>
      </Dropdown.Trigger>
      <Dropdown.Content align="end">
        <Dropdown.Label>Move to</Dropdown.Label>
        {statuses.filter((s) => s.id !== task.statusId).map((s) => (
          <Dropdown.Item key={s.id} onSelect={() => onMoveTo(task.id, s.id)}>
            <StatusIcon status={s} /> {s.name}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );

  return (
    <KanbanCard
      id={task.id}
      name={task.title}
      onClick={() => onOpen(task.id)}
      transitionName={cardTransitionName(task.id)}
      morphName={taskMorphName(task.id, openTaskId)}
      navColumn={task.statusId}
      action={moveMenu}
      footer={task.subtaskCount > 0 ? (
        <CardSubtasks
          task={task}
          statuses={statuses}
          workspaceSlug={workspaceSlug}
          expanded={expanded}
          openTaskId={openTaskId}
          onToggle={() => onToggleSubtasks(task.id)}
          onOpen={onOpen}
        />
      ) : undefined}
    >
      {/* pr clears the Move to… button in the corner. */}
      <p className="pr-7 text-paragraph-sm text-text-strong-950 max-sm:pr-10">{task.title}</p>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => <LabelChip key={label.id} name={label.name} />)}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {task.priority !== 'none' && (
          <Hint label="Priority">
            <span className="inline-flex"><PriorityChip priority={task.priority} /></span>
          </Hint>
        )}
        {task.dueDate && (
          <Hint label="Due date">
            <span className="inline-flex"><DueChip dueDate={task.dueDate} timezone={timezone} done={task.completedAt !== null} /></span>
          </Hint>
        )}
        {task.assigneeName && (
          <span className="ml-auto inline-flex">
            <AssigneeAvatar name={task.assigneeName} image={task.assigneeImage} />
          </span>
        )}
      </div>
    </KanbanCard>
  );
}
