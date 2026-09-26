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
    // Space only: dnd-kit also lifts on Enter by default, which would turn Enter on a
    // focused card into a drag instead of opening the task. Tab still drops (dnd-kit's
    // default), so focus never leaves a card that is mid-drag.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Tab'] },
    }),
  );

  /**
   * With a pointer (mouse, touch), only what the pointer is inside counts; no pointer hit
   * means the release is off the board, so no collision (`[]`) is reported and `onDragEnd`
   * discards the drag (event.over is null). Rect overlap is deliberately not consulted
   * here: the dragged card's rect can still overlap a column after the pointer has left
   * every column, and that would save a drop the user threw away. Without a pointer
   * (keyboard) there is no "off the board", so rect overlap, then closestCorners, pick the
   * target — with every droppable measured (MeasuringStrategy.Always) closestCorners always
   * finds one.
   *
   * The raw hit is then mapped:
   * - The dragged card itself (the live preview has moved it into the hovered column)
   *   resolves to its column flagged `data.self`, so dnd-kit keeps announcing the column
   *   (board.spec.ts, spec §10 A3) and Kanban treats it as "stay put".
   * - A column, with the pointer below its last card, resolves to the column unflagged:
   *   Kanban moves the card to the end of that column. Mapping to the nearest card here
   *   would let Kibo's arrayMove place the card before or after that card depending only
   *   on flat-array order.
   * - Any other column hit resolves to the nearest card inside it, so dropping into a gap
   *   keeps that gap. An empty column stays the column (append).
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointer = args.pointerCoordinates;
      const overId = pointer
        ? getFirstCollision(pointerWithin(args), 'id')
        : getFirstCollision(rectIntersection(args), 'id') ?? getFirstCollision(closestCorners(args), 'id');
      if (overId == null) return [];

      const id = String(overId);
      const activeId = String(args.active.id);

      if (id === activeId) {
        const column = items.find((item) => item.id === activeId)?.column;
        return column ? [{ id: column, data: { self: true } }] : [];
      }

      if (columns.some((column) => column.id === id)) {
        const cards = items.filter((item) => item.column === id && item.id !== activeId);
        if (cards.length > 0) {
          const last = args.droppableRects.get(cards[cards.length - 1].id);
          if (pointer && last && pointer.y > last.bottom) return [{ id }];

          const cardIds = new Set(cards.map((item) => item.id));
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
