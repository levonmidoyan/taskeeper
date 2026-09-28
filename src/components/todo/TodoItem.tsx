'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconCircle, IconCircleCheckFilled, IconDots, IconGripVertical, IconTrash,
} from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { TodoDuePicker } from '@/components/todo/TodoDuePicker';
import * as CompactButton from '@/components/ui/compact-button';
import * as Dropdown from '@/components/ui/dropdown';
import type { TodoRow } from '@/server/todos/queries';
import { cn } from '@/utils/cn';

export type TodoItemHandlers = {
  onToggle: (item: TodoRow) => void;
  onRename: (item: TodoRow, title: string) => void;
  onDue: (item: TodoRow, dueDate: string | null) => void;
  onDelete: (item: TodoRow) => void;
};

type RowProps = TodoItemHandlers & {
  item: TodoRow;
  timezone: string;
  handle?: React.ReactNode;
  rowRef?: (node: HTMLLIElement | null) => void;
  style?: React.CSSProperties;
  dragging?: boolean;
};

/** A completed row, or the body of a sortable one. */
export function TodoItem({
  item, timezone, handle, rowRef, style, dragging, onToggle, onRename, onDue, onDelete,
}: RowProps) {
  const done = item.completedAt !== null;
  const [editing, setEditing] = useState(false);
  // Enter commits and then unmounts the input, which fires blur: commit once.
  const settled = useRef(false);

  function startEdit() {
    settled.current = false;
    setEditing(true);
  }

  function commit(value: string) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const title = value.trim();
    // Blank or unchanged: revert rather than save.
    if (title && title !== item.title) onRename(item, title);
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
  }

  return (
    <li
      ref={rowRef}
      style={style}
      className={cn(
        'group flex items-center gap-1 border-b border-stroke-soft-200 bg-bg-white-0 px-1 transition-colors duration-150 last:border-b-0 hover:bg-bg-weak-50',
        dragging && 'relative z-10 shadow-regular-md',
      )}
    >
      {handle}

      {/* A toggle button, not a checkbox — same markup and names as the old TaskRow. */}
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-pressed={done}
        aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950"
      >
        {done
          ? <IconCircleCheckFilled className="size-5 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-5" aria-hidden="true" />}
      </button>

      {editing ? (
        <input
          autoFocus
          defaultValue={item.title}
          maxLength={200}
          aria-label={`Rename "${item.title}"`}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="h-9 min-w-0 flex-1 rounded-md bg-bg-white-0 px-2 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-primary-base"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="flex min-h-11 min-w-0 flex-1 items-center py-2 text-left"
        >
          <span
            data-todo-title
            className={cn(
              'min-w-0 flex-1 truncate text-paragraph-sm',
              done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
            )}
          >
            {item.title}
          </span>
        </button>
      )}

      <TodoDuePicker
        title={item.title}
        dueDate={item.dueDate}
        timezone={timezone}
        onChange={(dueDate) => onDue(item, dueDate)}
      />

      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <CompactButton.Root
            variant="ghost"
            size="large"
            aria-label={`More actions for "${item.title}"`}
            // Always visible on touch screens, hover-revealed on desktop.
            className="shrink-0 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100"
          >
            <CompactButton.Icon as={IconDots} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content align="end" className="w-40">
          <Dropdown.Item onSelect={() => onDelete(item)} className="text-error-base">
            <Dropdown.ItemIcon as={IconTrash} />
            Delete
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>
    </li>
  );
}

/** An open row: the whole row moves, but only the handle starts a drag. */
export function SortableTodoItem(props: TodoItemHandlers & { item: TodoRow; timezone: string }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.item.id });

  return (
    <TodoItem
      {...props}
      rowRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder "${props.item.title}"`}
          // touch-none: without it a touch on the handle scrolls instead of dragging.
          className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-text-soft-400 hover:text-text-strong-950 active:cursor-grabbing"
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      }
    />
  );
}
