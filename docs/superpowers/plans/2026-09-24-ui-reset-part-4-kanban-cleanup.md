# UI Reset — Part 4: Kanban Board and Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the board on an adapted copy of Kibo's Kanban (live cross-column preview, drag overlay, touch drag) without changing how moves are saved, rebuild the column manager on Align, then delete everything left of shadcn/radix-nova and lucide.

**Architecture:** Kibo's `KanbanProvider/Board/Header/Cards/Card` are copied into `src/components/kibo-ui/kanban/` with the fixes from spec §5.1 and §10 A3–A4. `Board` keeps a working copy of the items only while a drag is in progress (`dragItems ?? optimisticItems`), so there is no state-syncing effect. When the drop ends, a pure helper derives the neighbour ids from the final layout, and the existing `moveTaskAction` saves them. Cleanup removes `legacy-ui/`, the bridge CSS, `components.json` and the packages, and adds a unit test that keeps them out.

**Tech Stack:** as Parts 1–3, plus `tunnel-rat` 0.1.2; existing `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2.

**Spec:** `docs/superpowers/specs/2026-09-24-ui-reset-design.md` (§5.1, §9, §10 A3, A4, A6).

**Plan series:** Parts 1–3 (complete) → **Part 4 (this)**.

## Global Constraints

- Work on branch `feat/ui-reset`. Commit after every task. Conventional Commits, **no `Co-Authored-By` or any attribution trailer**.
- Do not change the `version` field in `package.json`. Pin new dependencies exactly (`yarn add -E`).
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/` before writing Next-specific code.
- Icons only from `@tabler/icons-react`; Align components and tokens only in new code.
- `board.spec.ts` is not edited. It relies on: columns as `region "<status name>"`; the card as `button "<title>"` inside its column; `tab "Board"`; dnd-kit's **default** live region (`[id^="DndLiveRegion"]`) saying "Draggable item", "droppable area status:" and "was dropped" (spec §10 A3); a server-action POST to `/board` per move.
- Moves are saved with neighbour ids only (`beforeId`/`afterId`), never a position.
- Kibo copies carry a header naming upstream path + commit (`haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263`) and every adaptation.
- Gate at the end of every task: `yarn typecheck && yarn lint && yarn test`; plus `yarn e2e` at the end of Tasks 3, 4 and 5.

## Review Focus

- **Dropping a card exactly where it started** → no server call and no toast (Task 1 `isUnchanged` test pins this).
- **Keyboard drag into an empty column** → the dragged card's own droppable overlaps the drag rect once it has moved, and dnd-kit would report "over itself"; the collision function maps that to the card's current column so the announcement keeps the `status:` id (Task 3 collision; `board.spec.ts` keyboard test).
- **Releasing outside every column, or pressing Escape mid-drag** → the card returns to where it was and nothing is saved, even though the live preview had already moved it (Task 2 `onDragCancel`, Task 3 `over === null` check).
- **Touch scrolling the board on a phone** → a swipe scrolls; only press-and-hold (250 ms) starts a drag. Mouse and Touch sensors, not Pointer (a PointerSensor also answers touch and would turn every swipe into a drag).
- **A second drag starting while the first move is still saving** → the board must not snap back mid-drag; the working copy is cleared only by drop or cancel, never by an async callback (Task 3 design).

---

### Task 1: Neighbour helpers (pure, TDD)

**Files:**
- Create: `src/components/board/neighbours.ts`
- Test: `tests/unit/board-neighbours.test.ts`

**Interfaces:**
- Produces:
  - `type Positioned = { id: string; column: string }`
  - `columnId(statusId: string): string` → `status:<id>`; `statusIdOf(column: string): string`
  - `neighboursAfterMove<T extends Positioned>(items: T[], taskId: string): { statusId: string; beforeId: string | null; afterId: string | null; index: number; columnSize: number } | null`
  - `isUnchanged<T extends Positioned>(before: T[], after: T[], taskId: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/board-neighbours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  columnId, isUnchanged, neighboursAfterMove, statusIdOf,
} from '@/components/board/neighbours';

const todo = columnId('todo');
const doing = columnId('doing');
const item = (id: string, column: string) => ({ id, column });

// Kibo keeps one flat array; order within a column is the order of its items.
const board = [item('a', todo), item('b', todo), item('c', todo), item('x', doing), item('y', doing)];

describe('column ids', () => {
  it('prefix and strip status:', () => {
    // The prefix is part of the e2e contract (dnd-kit announces "droppable area status:…").
    expect(columnId('abc')).toBe('status:abc');
    expect(statusIdOf('status:abc')).toBe('abc');
  });
});

describe('neighboursAfterMove', () => {
  it('reads the neighbours of a card moved up within its column', () => {
    const after = [item('a', todo), item('c', todo), item('b', todo), item('x', doing), item('y', doing)];
    expect(neighboursAfterMove(after, 'c')).toEqual({
      statusId: 'todo', beforeId: 'a', afterId: 'b', index: 1, columnSize: 3,
    });
  });

  it('handles the top and bottom of a column', () => {
    expect(neighboursAfterMove(board, 'a')).toMatchObject({ beforeId: null, afterId: 'b', index: 0 });
    expect(neighboursAfterMove(board, 'c')).toMatchObject({ beforeId: 'b', afterId: null, index: 2 });
  });

  it('handles a card moved into the middle of another column', () => {
    const after = [item('a', todo), item('c', todo), item('x', doing), item('b', doing), item('y', doing)];
    expect(neighboursAfterMove(after, 'b')).toEqual({
      statusId: 'doing', beforeId: 'x', afterId: 'y', index: 1, columnSize: 3,
    });
  });

  it('handles a card moved into an empty column', () => {
    const after = [item('a', todo), item('b', columnId('done'))];
    expect(neighboursAfterMove(after, 'b')).toEqual({
      statusId: 'done', beforeId: null, afterId: null, index: 0, columnSize: 1,
    });
  });

  it('returns null for an unknown card', () => {
    expect(neighboursAfterMove(board, 'nope')).toBeNull();
  });
});

describe('isUnchanged', () => {
  it('is true when the card ends where it started', () => {
    expect(isUnchanged(board, [...board], 'b')).toBe(true);
  });

  it('is false for a reorder or a column change', () => {
    const reordered = [item('b', todo), item('a', todo), item('c', todo), item('x', doing), item('y', doing)];
    expect(isUnchanged(board, reordered, 'b')).toBe(false);
    const moved = [item('a', todo), item('c', todo), item('x', doing), item('y', doing), item('b', doing)];
    expect(isUnchanged(board, moved, 'b')).toBe(false);
  });

  it('ignores reorders elsewhere on the board', () => {
    const others = [item('a', todo), item('b', todo), item('c', todo), item('y', doing), item('x', doing)];
    expect(isUnchanged(board, others, 'b')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/unit/board-neighbours.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/board/neighbours"`.

- [ ] **Step 3: Implement**

Create `src/components/board/neighbours.ts`:

```ts
/** Anything placed in a board column: Kibo's items are one flat array in display order. */
export type Positioned = { id: string; column: string };

const PREFIX = 'status:';

// Column droppable ids keep the status: prefix — board.spec.ts waits for dnd-kit to
// announce "droppable area status:…" (spec §10 A3).
export const columnId = (statusId: string) => `${PREFIX}${statusId}`;
export const statusIdOf = (column: string) => column.slice(PREFIX.length);

/** Where `taskId` sits after a drag, in the shape moveTaskAction needs. */
export function neighboursAfterMove<T extends Positioned>(items: T[], taskId: string) {
  const moved = items.find((i) => i.id === taskId);
  if (!moved) return null;

  const column = items.filter((i) => i.column === moved.column);
  const index = column.findIndex((i) => i.id === taskId);

  return {
    statusId: statusIdOf(moved.column),
    // Neighbour ids, never a position: the server computes the key so two
    // concurrent drags cannot land on the same one (v1 spec §6.4).
    beforeId: column[index - 1]?.id ?? null,
    afterId: column[index + 1]?.id ?? null,
    index,
    columnSize: column.length,
  };
}

/** True when the card is in the same column between the same neighbours. */
export function isUnchanged<T extends Positioned>(before: T[], after: T[], taskId: string) {
  const a = neighboursAfterMove(before, taskId);
  const b = neighboursAfterMove(after, taskId);
  return !!a && !!b && a.statusId === b.statusId && a.beforeId === b.beforeId && a.afterId === b.afterId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/unit/board-neighbours.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/board/neighbours.ts tests/unit/board-neighbours.test.ts
git commit -m "feat(board): pure neighbour helpers for Kanban moves"
```

---

### Task 2: Adapted Kibo Kanban

**Files:**
- Create: `src/components/kibo-ui/kanban/index.tsx`

**Interfaces:**
- Produces (all generic over `T extends KanbanItemProps`, `C extends KanbanColumnProps`):
  - `type KanbanItemProps = { id: string; name: string; column: string } & Record<string, unknown>`; `type KanbanColumnProps = { id: string; name: string } & Record<string, unknown>`
  - `KanbanProvider({ columns: C[]; data: T[]; children: (column: C) => ReactNode; className?; onDataChange?(data: T[]); onDragStart?(e); onDragOver?(e); onDragEnd?(e: DragEndEvent, data: T[]); onDragCancel?(); ...DndContextProps })` — `sensors`, `collisionDetection`, `measuring`, `id` pass through to `DndContext`; no announcements are overridden.
  - `KanbanBoard({ id, children, className, ...sectionProps })` — a `<section>` droppable.
  - `KanbanHeader(divProps)`.
  - `KanbanCards<T>({ id, children: (item: T) => ReactNode, empty?: ReactNode, ...ulProps })` — `<ul>` in a vertical `SortableContext`.
  - `KanbanCard({ id, name, children?, className?, onClick? })` — `<li><button>` with the dnd-kit listeners on the button.

- [ ] **Step 1: Dependency**

```bash
yarn add -E tunnel-rat@0.1.2
```

- [ ] **Step 2: Write the component**

Create `src/components/kibo-ui/kanban/index.tsx`:

```tsx
'use client';

/**
 * Kibo UI Kanban — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/kanban/index.tsx. Adapted (spec §5.1, §10 A3–A4):
 * - No built-in sensors or collision detection: the caller passes them (Kibo's MouseSensor
 *   had no activation distance, so a click read as a drag; closestCenter misfiles
 *   cross-column keyboard drops).
 * - No custom announcements: dnd-kit's defaults apply (Kibo's printed column ids, and
 *   board.spec.ts waits on the default wording).
 * - handleDragOver clones instead of mutating the item, appends when the target is a column
 *   rather than arrayMove(…, -1), and does nothing when the target is neither card nor
 *   column (Kibo fell back to the first column).
 * - onDragEnd receives the final data as its second argument. Kibo called it before its own
 *   final reorder, so a caller reading its state saw the pre-drop order.
 * - onDragCancel clears the overlay card (Kibo left it set).
 * - The DragOverlay portal renders only after mount (hydration).
 * - Columns are <section> (named regions via aria-label); cards are <li><button> with the
 *   listeners on the button, keeping native button semantics; CSS.Translate, not Transform,
 *   so cards do not scale between columns of different widths.
 * - shadcn Card and ScrollArea (Radix) replaced by Align-styled elements and native overflow.
 */

import {
  DndContext, type DndContextProps, type DragEndEvent, type DragOverEvent, DragOverlay,
  type DragStartEvent, useDroppable,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext, type HTMLAttributes, type ReactNode, useContext, useState, useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import tunnel from 'tunnel-rat';
import { cn } from '@/utils/cn';

const overlay = tunnel();

export type { DragEndEvent } from '@dnd-kit/core';

export type KanbanItemProps = { id: string; name: string; column: string } & Record<string, unknown>;
export type KanbanColumnProps = { id: string; name: string } & Record<string, unknown>;

type KanbanContextValue = {
  columns: KanbanColumnProps[];
  data: KanbanItemProps[];
  activeCardId: string | null;
};

const KanbanContext = createContext<KanbanContextValue>({ columns: [], data: [], activeCardId: null });

export type KanbanBoardProps = { id: string; children: ReactNode; className?: string } &
  Omit<HTMLAttributes<HTMLElement>, 'id' | 'children'>;

export function KanbanBoard({ id, children, className, ...props }: KanbanBoardProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-40 flex-col overflow-hidden rounded-2xl bg-bg-weak-50 ring-2 ring-inset transition-shadow duration-150',
        isOver ? 'ring-primary-base' : 'ring-transparent',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export type KanbanCardProps = {
  id: string;
  name: string;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
};

export function KanbanCard({ id, name, children, className, onClick }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transition, transform, isDragging } = useSortable({ id });
  const { activeCardId } = useContext(KanbanContext);
  const body = children ?? <p className="m-0 text-paragraph-sm text-text-strong-950">{name}</p>;

  return (
    <li ref={setNodeRef} style={{ transition, transform: CSS.Translate.toString(transform) }}>
      {/* dnd-kit puts the keyboard sensor on this button: Space lifts, arrows move, Space
          drops, Escape cancels (v1 spec §6.4). */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={cn(
          'w-full cursor-grab rounded-10 bg-bg-white-0 p-3 text-left shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 transition-shadow duration-150 hover:shadow-regular-sm active:cursor-grabbing',
          isDragging && 'pointer-events-none opacity-30',
          className,
        )}
      >
        {body}
      </button>
      {activeCardId === id && (
        <overlay.In>
          <div
            className={cn(
              'w-full cursor-grabbing rounded-10 bg-bg-white-0 p-3 shadow-regular-md ring-2 ring-primary-base',
              className,
            )}
          >
            {body}
          </div>
        </overlay.In>
      )}
    </li>
  );
}

export type KanbanCardsProps<T extends KanbanItemProps = KanbanItemProps> =
  Omit<HTMLAttributes<HTMLUListElement>, 'children' | 'id'> & {
    id: string;
    children: (item: T) => ReactNode;
    empty?: ReactNode;
  };

export function KanbanCards<T extends KanbanItemProps = KanbanItemProps>({
  id, children, empty, className, ...props
}: KanbanCardsProps<T>) {
  const { data } = useContext(KanbanContext) as KanbanContextValue & { data: T[] };
  const items = data.filter((item) => item.column === id);

  return (
    <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      <ul className={cn('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2', className)} {...props}>
        {items.length === 0 ? empty : items.map(children)}
      </ul>
    </SortableContext>
  );
}

export function KanbanHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('m-0 px-3 py-2', className)} {...props} />;
}

export type KanbanProviderProps<T extends KanbanItemProps, C extends KanbanColumnProps> =
  Omit<DndContextProps, 'children' | 'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDragCancel'> & {
    children: (column: C) => ReactNode;
    className?: string;
    columns: C[];
    data: T[];
    onDataChange?: (data: T[]) => void;
    onDragStart?: (event: DragStartEvent) => void;
    onDragOver?: (event: DragOverEvent) => void;
    /** Called after the final reorder, with the data as it now stands. */
    onDragEnd?: (event: DragEndEvent, data: T[]) => void;
    onDragCancel?: () => void;
  };

function moveToEnd<T>(items: T[], index: number): T[] {
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.push(moved);
  return next;
}

export function KanbanProvider<T extends KanbanItemProps, C extends KanbanColumnProps>({
  children, className, columns, data, onDataChange, onDragStart, onDragOver, onDragEnd,
  onDragCancel, ...props
}: KanbanProviderProps<T, C>) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  function handleDragStart(event: DragStartEvent) {
    if (data.some((item) => item.id === event.active.id)) setActiveCardId(String(event.active.id));
    onDragStart?.(event);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeIndex = data.findIndex((item) => item.id === active.id);
    if (activeIndex === -1) return;

    const overItem = data.find((item) => item.id === over.id);
    const overColumn = overItem?.column ?? columns.find((col) => col.id === over.id)?.id;
    if (!overColumn) return;

    if (data[activeIndex].column !== overColumn) {
      let next = data.map((item, i) => (i === activeIndex ? { ...item, column: overColumn } : item));
      next = overItem
        ? arrayMove(next, activeIndex, data.findIndex((item) => item.id === over.id))
        : moveToEnd(next, activeIndex);
      onDataChange?.(next);
    }

    onDragOver?.(event);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    const { active, over } = event;

    let next = data;
    if (over && active.id !== over.id) {
      const oldIndex = data.findIndex((item) => item.id === active.id);
      const newIndex = data.findIndex((item) => item.id === over.id);
      // A drop on a column (not a card) has no index: the card stays where
      // handleDragOver already put it.
      if (oldIndex !== -1 && newIndex !== -1) {
        next = arrayMove(data, oldIndex, newIndex);
        onDataChange?.(next);
      }
    }

    onDragEnd?.(event, next);
  }

  function handleDragCancel() {
    setActiveCardId(null);
    onDragCancel?.();
  }

  return (
    <KanbanContext.Provider value={{ columns, data, activeCardId }}>
      <DndContext
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        {...props}
      >
        <div className={cn('grid size-full auto-cols-fr grid-flow-col gap-4', className)}>
          {columns.map((column) => children(column))}
        </div>
        {mounted && createPortal(<DragOverlay><overlay.Out /></DragOverlay>, document.body)}
      </DndContext>
    </KanbanContext.Provider>
  );
}
```

- [ ] **Step 3: Gate and commit**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass (nothing uses the component yet).

```bash
git add package.json yarn.lock src/components/kibo-ui/kanban
git commit -m "feat(board): adapted Kibo Kanban components"
```

---

### Task 3: Board, columns and cards on Kibo Kanban

**Files (full rewrites):**
- `src/components/board/Board.tsx`
- `src/components/board/BoardColumn.tsx`
- `src/components/board/TaskCard.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 Kanban; `PriorityDot`, `DueChip`, `LabelChip`, `AssigneeAvatar` (Part 3 Task 1); `QuickAddTask`.
- Produces: `Board(props)` unchanged (`workspaceSlug, projectId, statuses, tasks, timezone`); `BoardColumn({ status, workspaceSlug, projectId, timezone, onOpen })`; `TaskCard({ task, timezone, onOpen })`; `type BoardItem = { id; name; column; task: TaskRow }`.

- [ ] **Step 1: Card**

Replace `src/components/board/TaskCard.tsx`:

```tsx
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
```

- [ ] **Step 2: Column**

Replace `src/components/board/BoardColumn.tsx`:

```tsx
'use client';

import type { BoardItem } from '@/components/board/Board';
import { columnId } from '@/components/board/neighbours';
import { TaskCard } from '@/components/board/TaskCard';
import { KanbanBoard, KanbanCards, KanbanHeader } from '@/components/kibo-ui/kanban';
import { QuickAddTask } from '@/components/task/QuickAddTask';
import type { StatusRow } from '@/server/projects/queries';

export function BoardColumn({
  status,
  count,
  workspaceSlug,
  projectId,
  timezone,
  onOpen,
}: {
  status: StatusRow;
  count: number;
  workspaceSlug: string;
  projectId: string;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const id = columnId(status.id);

  return (
    <KanbanBoard id={id} aria-label={status.name} className="w-[280px] shrink-0">
      <KanbanHeader>
        <h2 className="flex items-center gap-2 text-label-sm text-text-strong-950">
          {status.name}
          <span className="tabular text-paragraph-xs text-text-soft-400">{count}</span>
        </h2>
      </KanbanHeader>

      <KanbanCards<BoardItem>
        id={id}
        empty={
          <li className="rounded-10 border border-dashed border-stroke-sub-300 px-3 py-6 text-center text-paragraph-xs text-text-soft-400">
            Drop a task here
          </li>
        }
      >
        {(item) => <TaskCard key={item.id} task={item.task} timezone={timezone} onOpen={onOpen} />}
      </KanbanCards>

      <div className="border-t border-stroke-soft-200 px-3">
        <QuickAddTask
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statusId={status.id}
          placeholder={`Add to ${status.name}…`}
        />
      </div>
    </KanbanBoard>
  );
}
```

- [ ] **Step 3: Board**

Replace `src/components/board/Board.tsx`:

```tsx
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
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      const overId = getFirstCollision(hits, 'id');
      if (overId == null) return closestCorners(args);

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
```

Note the import cycle `Board.tsx ↔ BoardColumn.tsx` is type-only (`import type { BoardItem }`) and erased at compile time.

- [ ] **Step 4: Gate and e2e**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

Run: `yarn e2e tests/e2e/board.spec.ts`
Expected: all four tests pass (pointer drag + reload, keyboard-only drag + reload, deep link + back, subtask dialog).

If the keyboard test times out waiting for `droppable area status:`, log `getFirstCollision(hits)` inside `collisionDetection` during a manual keyboard drag: a card id there means the self-hit branch is not taking effect.

- [ ] **Step 5: Check by hand**

`yarn dev`, open a board with three columns and a few cards:
- Mouse: drag a card across columns — it jumps into the hovered column while dragging, a ghost follows the pointer, the target column gets a blue ring. Drop: it stays; reload: still there.
- Drop a card back where it started: no network POST.
- Drag, then press Escape: the card returns home; no POST.
- Click a card without moving: the task dialog opens.
- Browser devtools device mode (touch): a swipe scrolls the board sideways; press-and-hold then drag moves a card.
- Console: no hydration warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/board
git commit -m "feat(board): Kibo Kanban board with live preview and touch drag"
```

---

### Task 4: Column manager on Align

**Files:**
- Modify (full rewrite): `src/components/board/ManageColumnsDialog.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `CompactButton`, `Input`, `Select`, `Switch` (Part 1).
- Produces: unchanged `ManageColumnsDialog({ workspaceSlug, projectId, statuses, canEdit })`. Accessible names kept: `Move <name> left`, `Move <name> right`, `<name> name`, `<name> completes tasks`, `Delete <name>`, `New column name`, `Move tasks to`.

- [ ] **Step 1: Rewrite**

Replace `src/components/board/ManageColumnsDialog.tsx`:

```tsx
'use client';

import {
  IconArrowDown, IconArrowUp, IconColumns3, IconPlus, IconTrash,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Input from '@/components/ui/input';
import * as Modal from '@/components/ui/modal';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import type { StatusRow } from '@/server/projects/queries';
import {
  createStatusAction, deleteStatusAction, moveStatusAction, updateStatusAction,
} from '@/server/statuses/actions';

/**
 * Column management for a project: rename, reorder, add, delete, and mark which
 * column counts as done. Reordering is arrow buttons rather than drag — the board
 * already owns the drag gesture for cards, and this stays usable from the
 * keyboard without a second DndContext competing for the same pointer.
 *
 * Every write is a server round-trip followed by router.refresh(): the list here
 * is the server's, never a local copy that could drift from it.
 */
export function ManageColumnsDialog({
  workspaceSlug,
  projectId,
  statuses,
  canEdit,
}: {
  workspaceSlug: string;
  projectId: string;
  statuses: StatusRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [adding, setAdding] = useState('');

  // Only owners and admins may change the board's shape, so nobody else is
  // shown a dialog full of controls the server would refuse.
  if (!canEdit) return null;

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  function rename(status: StatusRow, name: string) {
    const trimmed = name.trim();
    if (trimmed === status.name) return;
    run(() => updateStatusAction(workspaceSlug, { statusId: status.id, name: trimmed }));
  }

  function move(index: number, direction: -1 | 1) {
    const status = statuses[index];
    // The two neighbours the column lands between once it has moved past one of
    // them. Ids, never a position: the server computes the key (v1 spec §6.4).
    const [beforeId, afterId] = direction === -1
      ? [statuses[index - 2]?.id ?? null, statuses[index - 1].id]
      : [statuses[index + 1].id, statuses[index + 2]?.id ?? null];

    run(() => moveStatusAction(workspaceSlug, { statusId: status.id, beforeId, afterId }));
  }

  function toggleDone(status: StatusRow) {
    run(
      () => updateStatusAction(workspaceSlug, { statusId: status.id, isDone: !status.isDone }),
      status.isDone ? `${status.name} no longer completes tasks.` : `${status.name} now completes tasks.`,
    );
  }

  function remove(status: StatusRow, reassignToId: string | null) {
    run(
      async () => {
        const result = await deleteStatusAction(workspaceSlug, { statusId: status.id, reassignToId });
        if (result.ok) setConfirmingId(null);
        return result;
      },
      `Deleted ${status.name}.`,
    );
  }

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = adding.trim();
    if (!name) return;
    run(
      async () => {
        const result = await createStatusAction(workspaceSlug, { projectId, name });
        if (result.ok) setAdding('');
        return result;
      },
      `Added ${name}.`,
    );
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmingId(null);
      }}
    >
      <Modal.Trigger asChild>
        <Button.Root variant="neutral" mode="stroke" size="xsmall">
          <Button.Icon as={IconColumns3} />
          Columns
        </Button.Root>
      </Modal.Trigger>
      <Modal.Content className="max-w-lg">
        <Modal.Header
          icon={IconColumns3}
          title="Columns"
          description="Rename, reorder, add, or remove this project’s columns."
        />

        <Modal.Body className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {statuses.map((status, index) => {
              const others = statuses.filter((s) => s.id !== status.id);

              return (
                <li
                  key={`${status.id}:${status.name}:${status.isDone}`}
                  className="rounded-10 p-2 ring-1 ring-inset ring-stroke-soft-200"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <CompactButton.Root
                        variant="ghost"
                        size="medium"
                        aria-label={`Move ${status.name} left`}
                        disabled={pending || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <CompactButton.Icon as={IconArrowUp} />
                      </CompactButton.Root>
                      <CompactButton.Root
                        variant="ghost"
                        size="medium"
                        aria-label={`Move ${status.name} right`}
                        disabled={pending || index === statuses.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <CompactButton.Icon as={IconArrowDown} />
                      </CompactButton.Root>
                    </div>

                    <Input.Root size="small" className="flex-1">
                      <Input.Wrapper>
                        <Input.Input
                          // Uncontrolled and remounted by the key above, so a rename
                          // that the server rejected or normalised snaps back to what
                          // is actually stored.
                          defaultValue={status.name}
                          aria-label={`${status.name} name`}
                          maxLength={32}
                          disabled={pending}
                          onBlur={(event) => rename(status, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                              event.currentTarget.value = status.name;
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </Input.Wrapper>
                    </Input.Root>

                    <span className="flex items-center gap-1.5 pl-1" title="Tasks in this column count as done">
                      <Switch.Root
                        checked={status.isDone}
                        onCheckedChange={() => toggleDone(status)}
                        disabled={pending}
                        aria-label={`${status.name} completes tasks`}
                      />
                      <span aria-hidden="true" className="hidden text-paragraph-xs text-text-sub-600 sm:inline">
                        Done
                      </span>
                    </span>

                    <CompactButton.Root
                      variant="ghost"
                      size="medium"
                      aria-label={`Delete ${status.name}`}
                      className="hover:text-error-base"
                      disabled={pending || statuses.length === 1}
                      onClick={() => setConfirmingId(confirmingId === status.id ? null : status.id)}
                    >
                      <CompactButton.Icon as={IconTrash} />
                    </CompactButton.Root>
                  </div>

                  {confirmingId === status.id && others.length > 0 && (
                    <DeleteColumnConfirm
                      status={status}
                      others={others}
                      pending={pending}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={(reassignToId) => remove(status, reassignToId)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          <form onSubmit={add} className="flex items-center gap-2">
            <Input.Root size="small" className="flex-1">
              <Input.Wrapper>
                <Input.Input
                  value={adding}
                  onChange={(event) => setAdding(event.target.value)}
                  placeholder="New column name"
                  aria-label="New column name"
                  maxLength={32}
                  disabled={pending}
                />
              </Input.Wrapper>
            </Input.Root>
            <Button.Root type="submit" size="small" disabled={pending || !adding.trim()}>
              <Button.Icon as={IconPlus} />
              Add
            </Button.Root>
          </form>

          <p className="text-paragraph-xs text-text-sub-600">
            A column switched to Done completes the tasks dropped into it, and a task’s done
            toggle sends it to the first such column.
          </p>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

/**
 * A column holding tasks cannot simply be dropped — task.status_id is RESTRICT
 * (v1 spec §3.2) — so the confirmation asks where its tasks should go. An empty
 * column ignores the answer, which is why the target is offered rather than
 * demanded: the client never needs to know the count.
 */
function DeleteColumnConfirm({
  status,
  others,
  pending,
  onCancel,
  onConfirm,
}: {
  status: StatusRow;
  others: StatusRow[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reassignToId: string) => void;
}) {
  const [target, setTarget] = useState(others[0].id);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-stroke-soft-200 pt-2">
      <p className="text-paragraph-xs text-text-sub-600">
        Delete <span className="text-label-xs text-text-strong-950">{status.name}</span> and move any
        tasks in it to:
      </p>
      <div className="flex items-center gap-2">
        <Select.Root size="small" value={target} onValueChange={setTarget} disabled={pending}>
          <Select.Trigger aria-label="Move tasks to" className="flex-1">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {others.map((other) => <Select.Item key={other.id} value={other.id}>{other.name}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Button.Root variant="neutral" mode="ghost" size="xsmall" disabled={pending} onClick={onCancel}>
          Cancel
        </Button.Root>
        <Button.Root variant="error" size="xsmall" disabled={pending} onClick={() => onConfirm(target)}>
          Delete
        </Button.Root>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate, e2e, visual**

Run: `yarn typecheck && yarn lint && yarn test && yarn e2e`
Expected: all pass.

By hand (owner account): open **Columns**; rename with Enter and revert with Escape; move a column up and down; switch a column to Done (toast); delete a column holding tasks, choosing the target in **Move tasks to**; add a column. Tab through the whole dialog: every control is reachable and focus is visible. Screen reader name check in devtools' accessibility pane: the switch reads "`<name>` completes tasks, switch, on/off".

- [ ] **Step 3: Commit**

```bash
git add src/components/board/ManageColumnsDialog.tsx
git commit -m "feat(board): rebuild column manager on Align"
```

---

### Task 5: Cleanup — remove shadcn, radix-nova, lucide and the bridge

**Files:**
- Delete: `src/components/legacy-ui/` (whole directory), `components.json`
- Modify: `src/app/globals.css` (drop the legacy import, the bridge, the legacy radii)
- Modify: `package.json`, `yarn.lock` (remove packages)
- Test: `tests/unit/ui-dependencies.test.ts`
- Modify: `docs/superpowers/specs/2026-09-24-ui-reset-design.md` (status line)

**Interfaces:**
- Produces: a unit test that keeps spec §9's dependency rules true after this branch.

- [ ] **Step 1: Write the failing guard test**

Create `tests/unit/ui-dependencies.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles('src');
const read = (path: string) => readFileSync(path, 'utf8');

describe('UI dependency rules (spec §9)', () => {
  it('has none of the removed UI packages', () => {
    for (const name of ['radix-ui', 'lucide-react', 'shadcn', 'cn', 'class-variance-authority']) {
      expect(deps, name).not.toHaveProperty(name);
    }
  });

  it('only keeps Radix primitives that an Align component imports', () => {
    const uiSources = files.filter((f) => f.startsWith(join('src', 'components', 'ui'))).map(read).join('\n');
    for (const name of Object.keys(deps).filter((d) => d.startsWith('@radix-ui/'))) {
      expect(uiSources, name).toContain(`'${name}'`);
    }
  });

  it('has no imports of removed icon or UI libraries, and no legacy-ui', () => {
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/from ['"](lucide-react|@remixicon\/react|radix-ui)['"]/);
      expect(src, file).not.toContain('legacy-ui');
    }
  });

  it('keeps hex colours out of app code', () => {
    // Vendored Align/Kibo source keeps upstream's literal SVG fills and masks (spec §9).
    const vendored = [join('src', 'components', 'ui'), join('src', 'components', 'kibo-ui')];
    const appFiles = files.filter((f) => /\.tsx?$/.test(f) && !vendored.some((v) => f.startsWith(v)));
    for (const file of appFiles) {
      expect(read(file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    }
  });
});
```

Run: `yarn test tests/unit/ui-dependencies.test.ts`
Expected: FAIL — `radix-ui` etc. are still in `package.json`, and `legacy-ui` still exists.

(If the hex check flags a legitimate non-colour string such as a URL fragment, tighten the regex for that file's case rather than disabling the check.)

- [ ] **Step 2: Delete the legacy layer**

```bash
grep -rln "legacy-ui" src && echo "STILL IMPORTED — rebuild those files first" || echo "unused"
git rm -rq src/components/legacy-ui components.json
yarn remove radix-ui lucide-react cn class-variance-authority shadcn
```

Expected: `unused` before the removals. If anything still imports `legacy-ui`, stop: a screen was missed in Parts 1–4 — rebuild it on Align before continuing.

- [ ] **Step 3: Trim `globals.css`**

Find out which bridged shadcn names are still used anywhere:

```bash
grep -rnoP "\b(bg|text|border|ring|outline|fill|stroke|divide|placeholder|caret|decoration|from|to|via)-(background|foreground|card|popover|muted|secondary|accent|border|input|ring|primary|destructive|success)(-foreground)?(?![\w-])(/\d+)?" src --include=*.tsx --include=*.ts
grep -rn "var(--radius-button)\|var(--radius-card)\|var(--radius-panel)" src
```

Expected: no output from either (Parts 2–4 rewrote Kibo copies on Align tokens). Then in `src/app/globals.css`:
- delete the line `@import "shadcn/tailwind.css";` and its `LEGACY` comment;
- delete the whole `Bridge: shadcn token names → Align tokens` comment and its `@theme inline { … }` block;
- delete the `LEGACY — radii` comment and its `:root { --radius-button … }` block.

If the first grep did print matches, replace each match with its Align token in that file (`bg-background`→`bg-bg-white-0`, `text-muted-foreground`→`text-text-sub-600`, `border-border`→`border-stroke-soft-200`, `bg-muted`→`bg-bg-weak-50`, `text-foreground`→`text-text-strong-950`, `ring-primary`→`ring-primary-base`, `text-destructive`→`text-error-base`) and re-run until it prints nothing, then delete the bridge. The spec (§3.3) allows a bridge only for names Kibo code needs; after this plan none do.

- [ ] **Step 4: Run the guard test and the spec §9 greps**

Run: `yarn test tests/unit/ui-dependencies.test.ts`
Expected: PASS (4 tests).

Run: `grep -rE "lucide-react|@remixicon|from 'radix-ui'" src ; echo "exit $?"`
Expected: no matches, `exit 1`.

- [ ] **Step 5: Full verification**

Run: `yarn typecheck && yarn lint && yarn test && yarn build && yarn e2e`
Expected: all pass. Paste the test and e2e summary lines into the PR description later.

Run `scripts/screenshots.mjs` against a production build on the test database; review every PNG in `test-results/screens/` (sign-in, home, list, board, task dialog, settings general and members × 1280/390 × light/dark). Look for: unstyled or black-bordered elements (a missed bridge name), low-contrast text in dark mode, clipped controls at 390px, anything still in Plus Jakarta Sans.

Keyboard pass in a browser: Tab from the top of each page to the bottom; every control shows focus; dialogs trap focus and close with Escape, returning focus to their trigger.

- [ ] **Step 6: Mark the spec implemented**

In `docs/superpowers/specs/2026-09-24-ui-reset-design.md`, change `**Status:** Approved for planning` to `**Status:** Implemented on feat/ui-reset (Parts 1–4)`.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/app/globals.css package.json yarn.lock components.json tests/unit/ui-dependencies.test.ts docs/superpowers/specs/2026-09-24-ui-reset-design.md
git commit -m "chore(ui): remove shadcn, radix-nova, lucide and the token bridge"
```
