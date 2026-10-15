'use client';

import { IconChevronRight } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DoneIcon, StrikeText } from '@/components/task/DoneMark';
import { settle } from '@/lib/settle';
import { progressPercent } from '@/lib/subtasks';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import { updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const SHOWN = 5;

/** Stops a click or key from reaching the card (open) or dnd-kit (drag). */
const contain = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

export function CardSubtasks({
  task, statuses, workspaceSlug, expanded, onToggle, onOpen,
}: {
  task: TaskRow;
  statuses: StatusRow[];
  workspaceSlug: string;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const subtasks = task.subtasks ?? [];
  const percent = progressPercent(task.subtaskDoneCount, task.subtaskCount);

  function toggleDone(sub: TaskRow) {
    const target = doneToggleTarget(statuses, sub.completedAt !== null);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await settle(updateTaskAction(workspaceSlug, { taskId: sub.id, statusId: target.id }));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div {...contain} className="px-3 pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        // aria-expanded carries the state, so the name stays put.
        aria-label={`Subtasks of ${task.title}`}
        onClick={onToggle}
        className="tabular -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-paragraph-xs text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950"
      >
        <IconChevronRight className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden="true" />
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-bg-soft-200" />
          <circle
            cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" pathLength={100}
            strokeDasharray={`${percent} 100`}
            className={percent === 100 ? 'stroke-success-base' : 'stroke-primary-base'}
          />
        </svg>
        {task.subtaskDoneCount}/{task.subtaskCount}
      </button>

      {expanded && (
        <ul className="mt-1 flex flex-col">
          {subtasks.slice(0, SHOWN).map((sub) => {
            const done = sub.completedAt !== null;
            return (
              <li key={sub.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={done}
                  aria-label={done ? `Mark “${sub.title}” as not done` : `Mark “${sub.title}” as done`}
                  onClick={() => toggleDone(sub)}
                  className="inline-flex size-7 shrink-0 items-center justify-center text-text-soft-400 hover:text-text-strong-950 disabled:opacity-50"
                >
                  <DoneIcon done={done} className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(sub.id)}
                  className={cn('min-w-0 flex-1 truncate py-1 text-left text-paragraph-xs', done ? 'text-text-soft-400' : 'text-text-strong-950')}
                >
                  <StrikeText done={done}>{sub.title}</StrikeText>
                </button>
                {sub.assigneeName && <AssigneeAvatar name={sub.assigneeName} image={sub.assigneeImage} className="size-5 text-[0.5625rem]" />}
              </li>
            );
          })}
          {subtasks.length > SHOWN && (
            <li>
              <button type="button" onClick={() => onOpen(task.id)} className="py-1 pl-8 text-paragraph-xs text-primary-base hover:underline">
                +{subtasks.length - SHOWN} more
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
