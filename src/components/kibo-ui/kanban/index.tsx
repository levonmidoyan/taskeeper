'use client';

/**
 * Kibo UI Kanban — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/kanban/index.tsx. Adapted (spec §5.1, §10 A3–A4):
 * - No built-in sensors or collision detection: the caller passes them (Kibo's MouseSensor
 *   had no activation distance, so a click read as a drag; closestCenter misfiles
 *   cross-column keyboard drops).
 * - No custom announcements: dnd-kit's defaults apply (Kibo's printed column ids, and
 *   board.spec.ts waits on the default wording).
 * - handleDragOver clones instead of mutating the item and does nothing when the target is
 *   neither card nor column (Kibo fell back to the first column).
 * - A column as the target (handleDragOver and handleDragEnd) means "the end of that
 *   column", including the card's own column — Kibo used arrayMove(…, -1) and ignored its
 *   own column. The one exception is a collision the caller flags `data.self` (the dragged
 *   card over itself, mapped to its column): the card stays where it is.
 * - onDragEnd receives the final data as its second argument. Kibo called it before its own
 *   final reorder, so a caller reading its state saw the pre-drop order.
 * - onDragCancel clears the overlay card (Kibo left it set).
 * - The DragOverlay portal renders only after mount (hydration); its content is
 *   aria-hidden, since it duplicates the card that is being dragged.
 * - Columns are <section> (named regions via aria-label); cards are <li><button> with the
 *   listeners on the button, keeping native button semantics; CSS.Translate, not Transform,
 *   so cards do not scale between columns of different widths.
 * - shadcn Card and ScrollArea (Radix) replaced by Align-styled elements and native overflow.
 *   The drop-target ring is drawn on an overlay above the column's content, so a footer
 *   does not paint over it. The provider has no grid defaults; the caller lays out columns.
 * - Motion (2026-10-08 motion spec): the overlay lifts and settles, the source card becomes an
 *   empty slot, columns tint while hovered. The overlay card stays set until the drop
 *   animation ends, so the settle animates the card rather than an empty frame.
 */

import {
  type Collision, DndContext, type DndContextProps, type DragEndEvent, type DragOverEvent,
  defaultDropAnimationSideEffects, type DropAnimation, DragOverlay, type DragStartEvent, useDroppable,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext, type HTMLAttributes, type ReactNode, useContext, useMemo, useState,
  useSyncExternalStore, ViewTransition,
} from 'react';
import { createPortal } from 'react-dom';
import tunnel from 'tunnel-rat';
import { DURATION, EASE_OUT_SOFT, EASE_SPRING, REMOTE_CHANGE, TASK_MORPH_SHARE } from '@/lib/motion';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/utils/cn';

const overlay = tunnel();

/**
 * The overlay glides into the slot and its lift (scale + tilt) eases back. The
 * source card stays invisible until then, so the swap back to it does not flash.
 * `onSettled` runs with the dropped card's id once the animation has finished.
 */
function dropAnimation(onSettled: (id: string) => void): DropAnimation {
  const sideEffects = defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0' } },
    className: { dragOverlay: 'kanban-settling' },
  });
  return {
    duration: DURATION.slow,
    easing: EASE_SPRING,
    sideEffects: (args) => {
      const cleanup = sideEffects(args);
      return () => {
        cleanup?.();
        onSettled(String(args.active.id));
      };
    },
  };
}

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
        // The ring sits on an ::after overlay above the content, so nothing inside the
        // column (such as a footer with its own background) paints over it.
        'relative flex min-h-40 flex-col overflow-hidden rounded-2xl transition-colors duration-120 ease-out-soft',
        'after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-2xl after:ring-2 after:ring-inset after:transition-shadow after:duration-120',
        isOver ? 'bg-primary-lighter after:ring-primary-base' : 'bg-bg-weak-50 after:ring-transparent',
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
  /**
   * Opts the card into view transitions (board cards; Task 4 names the button with it).
   * Without it the card renders no <ViewTransition>.
   */
  transitionName?: string;
  /** The name shared with the task modal; undefined while this card's task is open. */
  morphName?: string;
};

export function KanbanCard({ id, name, children, className, onClick, transitionName, morphName }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transition, transform, isDragging } = useSortable({
    id,
    transition: { duration: DURATION.base, easing: EASE_OUT_SOFT },
  });
  const { activeCardId } = useContext(KanbanContext);
  const body = children ?? <p className="m-0 text-paragraph-sm text-text-strong-950">{name}</p>;

  const card = (
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
          // The slot the card will land in: same size, content hidden but still named
          // for assistive tech.
          isDragging && 'pointer-events-none bg-primary-lighter shadow-none ring-0 outline-1 -outline-offset-1 outline-dashed outline-primary-base',
          className,
        )}
      >
        {transitionName ? (
          // Keyed by name: giving the name up remounts this boundary, which is what
          // pairs it with the modal's (React shares a name only between an unmount and
          // a mount). Only the body remounts; the button keeps focus and listeners.
          <ViewTransition key={morphName ?? 'open'} name={morphName} share={TASK_MORPH_SHARE} default="none">
            <span data-card-body className={cn('block', isDragging && 'opacity-0')}>{body}</span>
          </ViewTransition>
        ) : (
          <span data-card-body className={cn('block', isDragging && 'opacity-0')}>{body}</span>
        )}
      </button>
      {activeCardId === id && (
        <overlay.In>
          <div
            aria-hidden="true"
            className={cn(
              'w-full animate-kanban-lift cursor-grabbing rounded-10 bg-bg-white-0 p-3 shadow-regular-md ring-2 ring-primary-base',
              className,
            )}
          >
            {body}
          </div>
        </overlay.In>
      )}
    </li>
  );

  // A teammate's move slides the card; their add / delete grows / shrinks it. Only
  // live refreshes are tagged, so my own drops stay with dnd-kit. Outside the
  // <li>: React plays enter / exit only for a boundary above every DOM node it inserts.
  return transitionName ? (
    <ViewTransition name={transitionName} {...REMOTE_CHANGE}>{card}</ViewTransition>
  ) : card;
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

/** The caller's collision detection flags the dragged card over itself: "stay put". */
const isSelfHit = (collisions: Collision[] | null) => collisions?.[0]?.data?.self === true;

/**
 * The data with items[index] moved to the end of `column` (the flat array's end is the
 * column's end), or null when it is already there.
 */
function toColumnEnd<T extends KanbanItemProps>(items: T[], index: number, column: string): T[] | null {
  const item = items[index];
  if (item.column === column && items.findLastIndex((i) => i.column === column) === index) return null;
  return [...items.filter((_, i) => i !== index), { ...item, column }];
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
  const reducedMotion = useReducedMotion();
  // A newer drag may have started by the time a drop settles; it keeps its card.
  const drop = useMemo(
    () => (reducedMotion ? null : dropAnimation((id) => setActiveCardId((current) => (current === id ? null : current)))),
    [reducedMotion],
  );

  /** Ends the drag; with a drop animation the overlay card stays until it has settled. */
  function release() {
    if (!drop) setActiveCardId(null);
  }

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

    if (overItem) {
      // Within one column the sortable strategy previews the reorder; handleDragEnd
      // commits it.
      if (data[activeIndex].column !== overColumn) {
        const next = data.map((item, i) => (i === activeIndex ? { ...item, column: overColumn } : item));
        onDataChange?.(arrayMove(next, activeIndex, data.findIndex((item) => item.id === over.id)));
      }
    } else if (!isSelfHit(event.collisions)) {
      const next = toColumnEnd(data, activeIndex, overColumn);
      if (next) onDataChange?.(next);
    }

    onDragOver?.(event);
  }

  function handleDragEnd(event: DragEndEvent) {
    release();
    const { active, over } = event;

    let next = data;
    const oldIndex = data.findIndex((item) => item.id === active.id);
    if (over && active.id !== over.id && oldIndex !== -1) {
      const newIndex = data.findIndex((item) => item.id === over.id);
      if (newIndex !== -1) {
        next = arrayMove(data, oldIndex, newIndex);
        onDataChange?.(next);
      } else if (columns.some((col) => col.id === over.id) && !isSelfHit(event.collisions)) {
        // A drop on a column: the end of it. handleDragOver usually got there first, but
        // it only runs when the target changes, and self-hit → column keeps the same id.
        const moved = toColumnEnd(data, oldIndex, String(over.id));
        if (moved) {
          next = moved;
          onDataChange?.(next);
        }
      }
    }

    onDragEnd?.(event, next);
  }

  function handleDragCancel() {
    release();
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
        <div className={cn('flex size-full gap-4', className)}>
          {columns.map((column) => children(column))}
        </div>
        {mounted && createPortal(<DragOverlay dropAnimation={drop}><overlay.Out /></DragOverlay>, document.body)}
      </DndContext>
    </KanbanContext.Provider>
  );
}
