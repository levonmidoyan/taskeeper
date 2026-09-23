'use client';

import {
  DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor,
  closestCenter, closestCorners, getFirstCollision, pointerWithin, rectIntersection,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BoardColumn } from '@/components/board/BoardColumn';
import type { StatusRow } from '@/server/projects/queries';
import { moveTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';

type Move = { taskId: string; statusId: string; index: number };

export function Board({
  workspaceSlug,
  projectId,
  statuses,
  tasks,
  timezone,
}: {
  workspaceSlug: string;
  projectId: string;
  statuses: StatusRow[];
  tasks: TaskRow[];
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState('');

  // The card moves the instant it is dropped; the server call follows.
  const [optimisticTasks, applyMove] = useOptimistic(tasks, (current: TaskRow[], move: Move) => {
    const moving = current.find((t) => t.id === move.taskId);
    if (!moving) return current;

    const rest = current.filter((t) => t.id !== move.taskId);
    const target = rest.filter((t) => t.statusId === move.statusId);
    const others = rest.filter((t) => t.statusId !== move.statusId);
    const updated = { ...moving, statusId: move.statusId };

    target.splice(move.index, 0, updated);
    return [...others, ...target];
  });

  const sensors = useSensors(
    // An 8px threshold so a click to open the detail panel is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStatus = (statusId: string) => optimisticTasks.filter((t) => t.statusId === statusId);

  /**
   * Plain closestCorners is wrong for a multi-column board: a column is tall, so
   * its two far corners dominate the distance sum and it loses to the dragged
   * card's own rect. The card then reads as "over itself" however far it travels,
   * and a cross-column drop — every keyboard drop, which has no pointer to break
   * the tie — silently lands back in the column it started in.
   *
   * So: pointer first when there is one, rect overlap otherwise, and a hit on a
   * column resolves to the nearest card inside it, so dropping into a gap between
   * two cards keeps that gap instead of jumping to the end.
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      const overId = getFirstCollision(hits, 'id');
      if (overId == null) return closestCorners(args);

      const id = String(overId);
      if (id.startsWith('status:')) {
        const cardIds = new Set(
          optimisticTasks
            .filter((t) => t.statusId === id.slice('status:'.length))
            .map((t) => t.id)
            .filter((cardId) => cardId !== String(args.active.id)),
        );
        if (cardIds.size > 0) {
          const inner = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) => cardIds.has(String(c.id))),
          });
          const innerId = getFirstCollision(inner, 'id');
          if (innerId != null) return [{ id: innerId }];
        }
      }

      return [{ id: overId }];
    },
    [optimisticTasks],
  );

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('task', taskId);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);

    // Dropping on a column drops at its end; dropping on a card inserts at that card.
    const targetStatusId = overId.startsWith('status:')
      ? overId.slice('status:'.length)
      : optimisticTasks.find((t) => t.id === overId)?.statusId;

    if (!targetStatusId) return;

    const column = byStatus(targetStatusId).filter((t) => t.id !== taskId);
    const index = overId.startsWith('status:')
      ? column.length
      : Math.max(0, column.findIndex((t) => t.id === overId));

    const beforeId = column[index - 1]?.id ?? null;
    const afterId = column[index]?.id ?? null;

    const statusName = statuses.find((s) => s.id === targetStatusId)?.name ?? 'column';
    setAnnouncement(`Moved to ${statusName}, position ${index + 1} of ${column.length + 1}.`);

    startTransition(async () => {
      applyMove({ taskId, statusId: targetStatusId, index });

      // Neighbour ids, never a position: the server computes the key so two
      // concurrent drags cannot land on the same one (spec §6.4).
      const result = await moveTaskAction(workspaceSlug, {
        taskId, statusId: targetStatusId, beforeId, afterId,
      });

      if (!result.ok) {
        toast.error(result.error, {
          action: {
            label: 'Retry',
            onClick: () => {
              startTransition(async () => {
                const retry = await moveTaskAction(workspaceSlug, {
                  taskId, statusId: targetStatusId, beforeId, afterId,
                });
                if (!retry.ok) toast.error(retry.error);
                router.refresh();
              });
            },
          },
        });
      }
      // Refresh either way: on success to confirm, on failure to discard the
      // optimistic move and show the truth.
      router.refresh();
    });
  }

  return (
    // An explicit id: dnd-kit otherwise numbers its aria-describedby targets from
    // a module-level counter, which starts from a different value on the server
    // than in the browser and trips a hydration mismatch.
    <DndContext
      id="project-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Always, not the default WhileDragging: a keyboard drag can have its
      // first arrow key handled before the columns have been measured, and an
      // unmeasured droppable is not a collision candidate — so the card would
      // travel nowhere and drop back into the column it started in.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragEnd={onDragEnd}
    >
      {/* Horizontal scroll lives here, never on the page (spec §6.4). */}
      <div className="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 lg:px-6">
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            tasks={byStatus(status.id)}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            timezone={timezone}
            onOpen={openTask}
          />
        ))}
      </div>

      <p aria-live="polite" className="sr-only">{announcement}</p>
    </DndContext>
  );
}
