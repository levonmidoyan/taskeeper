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
  const items = data.filter((item) => item.column === id) as T[];

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
