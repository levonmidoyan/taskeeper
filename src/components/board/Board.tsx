'use client';

import {
  type CollisionDetection, closestCenter, closestCorners, type DragEndEvent, getFirstCollision,
  KeyboardSensor, MeasuringStrategy, MouseSensor, pointerWithin, rectIntersection, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BoardColumn } from '@/components/board/BoardColumn';
import { columnId, isUnchanged, neighboursAfterMove } from '@/components/board/neighbours';
import { KanbanProvider } from '@/components/kibo-ui/kanban';
import type { StatusRow } from '@/server/projects/queries';
import { moveTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';

export type BoardItem = { id: string; name: string; column: string; task: TaskRow };

type Move = { taskId: string; statusId: string; index: number };

const toItems = (tasks: TaskRow[]): BoardItem[] =>
  tasks.map((task) => ({ id: task.id, name: task.title, column: columnId(task.statusId), task }));

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

  // The card lands the instant it is dropped; the server call follows.
  const [optimisticTasks, applyMove] = useOptimistic(tasks, (current: TaskRow[], move: Move) => {
    const moving = current.find((t) => t.id === move.taskId);
    if (!moving) return current;

    const rest = current.filter((t) => t.id !== move.taskId);
    const target = rest.filter((t) => t.statusId === move.statusId);
    const others = rest.filter((t) => t.statusId !== move.statusId);
    target.splice(move.index, 0, { ...moving, statusId: move.statusId });
    return [...others, ...target];
  });

  const baseItems = useMemo(() => toItems(optimisticTasks), [optimisticTasks]);
  // Kibo's working copy exists only while a drag is in progress. Every other time the
  // board shows the (optimistic) server list directly, so nothing has to be synced. Only
  // drop and cancel clear it — never an async callback, which could land mid-way through
  // the next drag.
  const [dragItems, setDragItems] = useState<BoardItem[] | null>(null);
  const items = dragItems ?? baseItems;

  const columns = useMemo(
    () => statuses.map((status) => ({ id: columnId(status.id), name: status.name, status })),
    [statuses],
  );

  const sensors = useSensors(
    // An 8px threshold so a click to open the task is not read as a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Press and hold, so a swipe still scrolls the board. Mouse + Touch rather than
    // Pointer: a PointerSensor also answers touch and would start a drag on every swipe.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Pointer first when there is one, rect overlap otherwise (a keyboard drag has no
   * pointer). A hit on a column resolves to the nearest card inside it, so dropping into a
   * gap keeps that gap. A hit on the dragged card itself — which happens once the live
   * preview has moved it into the hovered column — resolves to that card's column, so
   * dnd-kit keeps announcing the column (board.spec.ts, spec §10 A3).
   *
   * With a pointer, no pointer/rect hit means the release is off the board entirely: report
   * no collision (`[]`) rather than falling back to closestCorners, which — with every
   * droppable measured (MeasuringStrategy.Always) — always finds *something* nearest and
   * would silently save the drag instead of discarding it (event.over must be null for the
   * `onDragEnd` discard-guard to fire). Without a pointer (keyboard), there is no "off the
   * board" to detect, so closestCorners is the only option; its result is fed through the
   * same self-hit / column mapping below rather than returned directly.
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(hits, 'id');

      if (overId == null) {
        if (args.pointerCoordinates != null) return [];
        overId = getFirstCollision(closestCorners(args), 'id');
        if (overId == null) return [];
      }

      const id = String(overId);
      const activeId = String(args.active.id);

      if (id === activeId) {
        const column = items.find((item) => item.id === activeId)?.column;
        return column ? [{ id: column }] : [];
      }

      if (columns.some((column) => column.id === id)) {
        const cardIds = new Set(
          items.filter((item) => item.column === id && item.id !== activeId).map((item) => item.id),
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
    [items, columns],
  );

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('task', taskId);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDragEnd(event: DragEndEvent, finalItems: BoardItem[]) {
    setDragItems(null);
    // Released outside every column: the live preview is discarded, nothing is saved.
    if (!event.over) return;

    const taskId = String(event.active.id);
    const after = neighboursAfterMove(finalItems, taskId);
    if (!after || isUnchanged(baseItems, finalItems, taskId)) return;

    const statusName = statuses.find((s) => s.id === after.statusId)?.name ?? 'column';
    setAnnouncement(`Moved to ${statusName}, position ${after.index + 1} of ${after.columnSize}.`);

    const input = { taskId, statusId: after.statusId, beforeId: after.beforeId, afterId: after.afterId };

    startTransition(async () => {
      applyMove({ taskId, statusId: after.statusId, index: after.index });

      const result = await moveTaskAction(workspaceSlug, input);

      if (!result.ok) {
        toast.error(result.error, {
          action: {
            label: 'Retry',
            onClick: () => {
              startTransition(async () => {
                const retry = await moveTaskAction(workspaceSlug, input);
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
    <>
      <KanbanProvider
        // An explicit id: dnd-kit otherwise numbers its aria-describedby targets from a
        // module-level counter, which differs between server and browser (hydration).
        id="project-board"
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Always, not WhileDragging: a keyboard drag can have its first arrow key handled
        // before the columns have been measured, and an unmeasured droppable is not a
        // collision candidate.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        columns={columns}
        data={items}
        onDataChange={setDragItems}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragItems(null)}
        // Horizontal scroll lives here, never on the page (v1 spec §6.4).
        className="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 lg:px-6"
      >
        {(column) => (
          <BoardColumn
            key={column.id}
            status={column.status}
            count={items.filter((item) => item.column === column.id).length}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            timezone={timezone}
            onOpen={openTask}
          />
        )}
      </KanbanProvider>

      <p aria-live="polite" className="sr-only">{announcement}</p>
    </>
  );
}
