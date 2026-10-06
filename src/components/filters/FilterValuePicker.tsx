'use client';

import { IconCheck } from '@tabler/icons-react';
import { useState } from 'react';
import * as Input from '@/components/ui/input';
import { DUE_PRESETS, type TaskFilter } from '@/lib/task-filter';
import { cn } from '@/utils/cn';
import {
  DUE_LABEL, selectedValues, setDueRange, setValues, valueOptions, type FilterField, type FilterOptions,
} from './filter-chips';

/** Multi-select list with a search box, or due presets plus a from/to range. */
export function FilterValuePicker({
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
  const [query, setQuery] = useState('');

  if (field === 'due') {
    const due = filter.due;
    const range = due && !('preset' in due) ? due : {};
    const setRange = (patch: { from?: string; to?: string }) => onChange(setDueRange(filter, patch));
    return (
      <div className="flex w-64 flex-col gap-1 p-1">
        {DUE_PRESETS.map((preset) => {
          const active = !!due && 'preset' in due && due.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => onChange({ ...filter, due: { preset } })}
              className="flex h-8 items-center justify-between rounded-lg px-2 text-left text-label-sm text-text-strong-950 hover:bg-bg-weak-50"
            >
              {DUE_LABEL[preset]}
              {active && <IconCheck className="size-4 text-primary-base" aria-hidden="true" />}
            </button>
          );
        })}
        <div className="mt-1 grid grid-cols-2 gap-2 border-t border-stroke-soft-200 px-1 pt-2">
          <label className="flex flex-col gap-1 text-label-xs text-text-sub-600">
            From
            <Input.Root size="small"><Input.Wrapper>
              <Input.Input type="date" value={range.from ?? ''} onChange={(e) => setRange({ from: e.target.value })} />
            </Input.Wrapper></Input.Root>
          </label>
          <label className="flex flex-col gap-1 text-label-xs text-text-sub-600">
            To
            <Input.Root size="small"><Input.Wrapper>
              <Input.Input type="date" value={range.to ?? ''} onChange={(e) => setRange({ to: e.target.value })} />
            </Input.Wrapper></Input.Root>
          </label>
        </div>
      </div>
    );
  }

  // Pinned after the due branch so the closure below keeps the narrowed type.
  const listField = field;
  const all = valueOptions(listField, options);
  const chosen = selectedValues(listField, filter);
  const shown = all.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(value: string) {
    const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
    onChange(setValues(listField, filter, next));
  }

  return (
    <div className="flex w-64 flex-col gap-1 p-1">
      {all.length > 6 && (
        <Input.Root size="small"><Input.Wrapper>
          <Input.Input autoFocus placeholder="Search…" aria-label="Search values" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Input.Wrapper></Input.Root>
      )}
      <div role="listbox" aria-multiselectable="true" aria-label="Values" className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <p className="px-2 py-2 text-paragraph-sm text-text-sub-600">No matches.</p>}
        {shown.map((o) => {
          const on = chosen.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => toggle(o.value)}
              className={cn('flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-label-sm hover:bg-bg-weak-50',
                on ? 'text-text-strong-950' : 'text-text-sub-600')}
            >
              <span className="truncate">{o.label}</span>
              {on && <IconCheck className="size-4 shrink-0 text-primary-base" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
