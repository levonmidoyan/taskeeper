'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconAdjustmentsHorizontal, IconGripVertical, IconPin } from '@tabler/icons-react';
import { useState } from 'react';
import * as Button from '@/components/ui/button';
import * as Popover from '@/components/ui/popover';
import * as SegmentedControl from '@/components/ui/segmented-control';
import * as Switch from '@/components/ui/switch';
import {
  COLUMN_LABEL,
  DEFAULT_TABLE_SETTINGS,
  PAGE_SIZES,
  PINNED_COLUMN,
  type Density,
  type PageSize,
  type TableColumn,
  type TableSettings,
} from '@/lib/task-table-settings';
import { cn } from '@/utils/cn';

/**
 * The List table's view settings: which columns show and in what order, row
 * density, and rows per page. They belong to this browser, not the project, so
 * changes apply at once with no save step.
 */
export function TaskTableSettings({
  settings,
  onChange,
  onReset,
}: {
  settings: TableSettings;
  onChange: (patch: Partial<TableSettings>) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const movable = settings.columnOrder.filter((c) => c !== PINNED_COLUMN);
  const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_TABLE_SETTINGS);

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const from = movable.indexOf(active.id as TableColumn);
    const to = movable.indexOf(over.id as TableColumn);
    if (from < 0 || to < 0) return;
    onChange({ columnOrder: [PINNED_COLUMN, ...arrayMove(movable, from, to)] });
  }

  function toggle(id: TableColumn, shown: boolean) {
    onChange({ hidden: shown ? settings.hidden.filter((c) => c !== id) : [...settings.hidden, id] });
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button.Root variant="neutral" mode="stroke" size="xsmall">
          <Button.Icon as={IconAdjustmentsHorizontal} />
          View
        </Button.Root>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        sideOffset={8}
        showArrow={false}
        className="flex w-72 flex-col gap-4 p-4"
        // Escape mid-drag cancels the drag; it must not also close the popover.
        onEscapeKeyDown={(event) => { if (dragging) event.preventDefault(); }}
      >
        <section className="flex flex-col gap-2">
          <h3 className="text-label-xs text-text-sub-600">Columns</h3>
          <ul className="flex flex-col gap-0.5">
            <li className="flex h-8 items-center gap-1.5 rounded-lg px-1">
              <span className="flex size-6 items-center justify-center text-text-soft-400" title="Always first">
                <IconPin className="size-4" aria-hidden="true" />
              </span>
              <span className="flex-1 text-paragraph-sm text-text-strong-950">{COLUMN_LABEL[PINNED_COLUMN]}</span>
              <Switch.Root checked disabled aria-label={`Show ${COLUMN_LABEL[PINNED_COLUMN]}`} />
            </li>
          </ul>
          <DndContext
            // An explicit id: dnd-kit's counter-based ids differ between server and browser.
            id="table-settings-columns"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(false)}
          >
            <SortableContext items={movable} strategy={verticalListSortingStrategy}>
              <ul className="-mt-2 flex flex-col gap-0.5">
                {movable.map((id) => (
                  <ColumnRow
                    key={id}
                    id={id}
                    shown={!settings.hidden.includes(id)}
                    onToggle={(shown) => toggle(id, shown)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-label-xs text-text-sub-600">Density</h3>
          <SegmentedControl.Root
            value={settings.density}
            onValueChange={(value) => onChange({ density: value as Density })}
          >
            <SegmentedControl.List>
              <SegmentedControl.Trigger value="comfortable">Comfortable</SegmentedControl.Trigger>
              <SegmentedControl.Trigger value="compact">Compact</SegmentedControl.Trigger>
            </SegmentedControl.List>
          </SegmentedControl.Root>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-label-xs text-text-sub-600">Rows per page</h3>
          <SegmentedControl.Root
            value={String(settings.pageSize)}
            onValueChange={(value) => onChange({ pageSize: Number(value) as PageSize })}
          >
            <SegmentedControl.List>
              {PAGE_SIZES.map((size) => (
                <SegmentedControl.Trigger key={size} value={String(size)}>
                  {size}
                </SegmentedControl.Trigger>
              ))}
            </SegmentedControl.List>
          </SegmentedControl.Root>
        </section>

        <Button.Root
          variant="neutral"
          mode="ghost"
          size="xsmall"
          className="self-start"
          disabled={isDefault}
          onClick={onReset}
        >
          Reset to default
        </Button.Root>
      </Popover.Content>
    </Popover.Root>
  );
}

function ColumnRow({
  id,
  shown,
  onToggle,
}: {
  id: TableColumn;
  shown: boolean;
  onToggle: (shown: boolean) => void;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id });
  const label = COLUMN_LABEL[id];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative flex h-8 items-center gap-1.5 rounded-lg bg-bg-white-0 px-1',
        isDragging && 'z-10 shadow-regular-md ring-1 ring-inset ring-primary-base',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${label}`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-soft-400 hover:text-text-sub-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="size-4" aria-hidden="true" />
      </button>
      <span className={cn('flex-1 text-paragraph-sm', shown ? 'text-text-strong-950' : 'text-text-soft-400')}>
        {label}
      </span>
      <Switch.Root checked={shown} onCheckedChange={onToggle} aria-label={`Show ${label}`} />
    </li>
  );
}
