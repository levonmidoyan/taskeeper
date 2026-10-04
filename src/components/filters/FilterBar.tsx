'use client';

import { IconFilter, IconLoader2, IconPlus, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import * as Button from '@/components/ui/button';
import * as Input from '@/components/ui/input';
import * as Popover from '@/components/ui/popover';
import * as SegmentedControl from '@/components/ui/segmented-control';
import { isFiltered, type TaskFilter, type TaskState } from '@/lib/task-filter';
import {
  chipValues, FILTER_FIELDS, fieldLabel, isNegated, removeField, toggleOp, type FilterField, type FilterOptions,
} from './filter-chips';
import { useFilterNav } from './FilterScope';
import { FilterValuePicker } from './FilterValuePicker';

export function FilterBar({
  filter,
  defaultState,
  options,
  children,
}: {
  filter: TaskFilter;
  defaultState: TaskState;
  options: FilterOptions;
  /** The view controls (save / modified / view menu), right-aligned. */
  children?: React.ReactNode;
}) {
  const { pending, apply } = useFilterNav();
  const fields = FILTER_FIELDS.filter((f) => f !== 'status' || options.statuses);
  const active = fields.filter((f) => filter[f] !== undefined);
  const [adding, setAdding] = useState(false);
  const [addField, setAddField] = useState<FilterField | null>(null);
  const [text, setText] = useState(filter.q ?? '');

  // Follow the URL when it changes underneath (back button, Reset, view switch).
  const [syncedQ, setSyncedQ] = useState(filter.q ?? '');
  if (syncedQ !== (filter.q ?? '')) {
    setSyncedQ(filter.q ?? '');
    setText(filter.q ?? '');
  }

  // Debounced text: one navigation per pause, not per keystroke.
  const latest = useRef(filter);
  useEffect(() => {
    latest.current = filter;
  });
  useEffect(() => {
    if (text.trim() === (filter.q ?? '')) return;
    const t = setTimeout(() => {
      const q = text.trim();
      apply(q ? { ...latest.current, q } : removeField('q', latest.current));
    }, 300);
    return () => clearTimeout(t);
  }, [text, filter.q, apply]);

  // F opens "+ Filter", like the other single-key shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'f' || ignoreShortcut(e)) return;
      e.preventDefault();
      setAdding(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div role="toolbar" aria-label="Filters" className="flex flex-wrap items-center gap-2 border-b border-stroke-soft-200 px-4 py-2 lg:px-6">
      <SegmentedControl.Root value={filter.state ?? defaultState} onValueChange={(v) => apply({ ...filter, state: v as TaskState })}>
        <SegmentedControl.List aria-label="Task state">
          <SegmentedControl.Trigger value="open">Open</SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="done">Done</SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="all">All</SegmentedControl.Trigger>
        </SegmentedControl.List>
      </SegmentedControl.Root>

      {active.map((field) => (
        <FilterChip key={field} field={field} filter={filter} options={options} onChange={apply} />
      ))}

      <Popover.Root open={adding} onOpenChange={(open) => { setAdding(open); if (!open) setAddField(null); }}>
        <Popover.Trigger asChild>
          <Button.Root variant="neutral" mode="ghost" size="xxsmall">
            <Button.Icon as={IconPlus} />
            Filter
          </Button.Root>
        </Popover.Trigger>
        <Popover.Content align="start" className="p-1">
          {addField ? (
            <FilterValuePicker field={addField} filter={filter} options={options} onChange={apply} />
          ) : (
            <div role="menu" aria-label="Add filter" className="flex w-48 flex-col">
              {fields.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  onClick={() => setAddField(f)}
                  className="flex h-8 items-center rounded-lg px-2 text-left text-label-sm text-text-strong-950 hover:bg-bg-weak-50"
                >
                  {fieldLabel(f)}
                </button>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Root>

      <Input.Root size="small" className="w-48">
        <Input.Wrapper>
          <Input.Icon as={IconFilter} />
          <Input.Input
            aria-label="Filter by text"
            placeholder="Filter by text…"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        </Input.Wrapper>
      </Input.Root>

      {isFiltered(filter, defaultState) && (
        <Button.Root variant="neutral" mode="ghost" size="xxsmall" onClick={() => { setText(''); apply({ state: defaultState }); }}>
          Clear
        </Button.Root>
      )}

      {pending && <IconLoader2 className="size-4 animate-spin text-text-soft-400" aria-label="Updating results" />}

      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

function FilterChip({
  field,
  filter,
  options,
  onChange,
}: {
  field: FilterField;
  filter: TaskFilter;
  options: FilterOptions;
  onChange: (filter: TaskFilter) => void;
}) {
  const negated = isNegated(field, filter);
  const opLabel = field === 'due' ? 'is' : field === 'labels' ? (negated ? 'has none of' : 'has any of') : negated ? 'is not' : 'is';
  return (
    <div className="inline-flex h-7 items-center rounded-lg bg-bg-weak-50 text-label-xs text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200">
      <span className="pl-2 text-text-sub-600">{fieldLabel(field)}</span>
      {field === 'due' ? (
        <span className="px-1 text-text-sub-600">{opLabel}</span>
      ) : (
        <button
          type="button"
          onClick={() => onChange(toggleOp(field, filter))}
          aria-label={`${fieldLabel(field)}: switch between including and excluding`}
          className="px-1 text-text-sub-600 underline-offset-2 hover:underline"
        >
          {opLabel}
        </button>
      )}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="max-w-48 truncate px-1 hover:underline" aria-label={`Edit ${fieldLabel(field)} filter`}>
            {chipValues(field, filter, options)}
          </button>
        </Popover.Trigger>
        <Popover.Content align="start" className="p-1">
          <FilterValuePicker field={field} filter={filter} options={options} onChange={onChange} />
        </Popover.Content>
      </Popover.Root>
      <button
        type="button"
        onClick={() => onChange(removeField(field, filter))}
        aria-label={`Remove ${fieldLabel(field)} filter`}
        className="flex h-full items-center rounded-r-lg px-1.5 text-text-soft-400 hover:text-text-strong-950"
      >
        <IconX className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
