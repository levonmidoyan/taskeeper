import { PRIORITY_LABEL } from '@/components/task/Priority';
import { PRIORITIES, type DuePreset, type FilterPriority, type TaskFilter } from '@/lib/task-filter';

export type FilterOptions = {
  statuses?: { id: string; name: string; color: string; isDone: boolean; icon: string | null }[];
  members: { userId: string; name: string; image: string | null }[];
  labels: { id: string; name: string; color: string }[];
};

export const FILTER_FIELDS = ['status', 'priority', 'assignee', 'labels', 'createdBy', 'due'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

const FIELD_LABEL: Record<FilterField, string> = {
  status: 'Status', priority: 'Priority', assignee: 'Assignee', labels: 'Labels', createdBy: 'Created by', due: 'Due',
};
export const fieldLabel = (field: FilterField) => FIELD_LABEL[field];

export const DUE_LABEL: Record<DuePreset, string> = {
  overdue: 'Overdue', today: 'Today', this_week: 'This week', next_7d: 'Next 7 days', none: 'No due date',
};

export function valueOptions(field: Exclude<FilterField, 'due'>, options: FilterOptions): { value: string; label: string }[] {
  const people = options.members.map((m) => ({ value: m.userId, label: m.name }));
  switch (field) {
    case 'status': return (options.statuses ?? []).map((s) => ({ value: s.id, label: s.name }));
    case 'priority': return [...PRIORITIES].reverse().map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
    case 'assignee': return [{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...people];
    case 'createdBy': return [{ value: 'me', label: 'Me' }, ...people];
    case 'labels': return options.labels.map((l) => ({ value: l.id, label: l.name }));
  }
}

/** The ids or values a field currently holds. */
export function selectedValues(field: Exclude<FilterField, 'due'>, filter: TaskFilter): string[] {
  if (field === 'priority') return filter.priority?.values ?? [];
  return filter[field]?.ids ?? [];
}

export function isNegated(field: FilterField, filter: TaskFilter): boolean {
  if (field === 'due') return false;
  if (field === 'labels') return filter.labels?.op === 'none';
  return filter[field]?.op === 'not';
}

export function chipValues(field: FilterField, filter: TaskFilter, options: FilterOptions): string {
  if (field === 'due') {
    const due = filter.due;
    if (!due) return '';
    if ('preset' in due) return DUE_LABEL[due.preset];
    if (due.from && due.to) return `${due.from} – ${due.to}`;
    return due.from ? `from ${due.from}` : `until ${due.to}`;
  }
  const names = new Map(valueOptions(field, options).map((o) => [o.value, o.label]));
  return selectedValues(field, filter).map((v) => names.get(v) ?? 'Unknown').join(', ');
}

export function toggleOp(field: Exclude<FilterField, 'due'>, filter: TaskFilter): TaskFilter {
  if (field === 'labels' && filter.labels) {
    return { ...filter, labels: { ...filter.labels, op: filter.labels.op === 'any' ? 'none' : 'any' } };
  }
  if (field === 'priority' && filter.priority) {
    return { ...filter, priority: { ...filter.priority, op: filter.priority.op === 'is' ? 'not' : 'is' } };
  }
  if (field !== 'labels' && field !== 'priority' && filter[field]) {
    const cur = filter[field]!;
    return { ...filter, [field]: { ...cur, op: cur.op === 'is' ? 'not' : 'is' } };
  }
  return filter;
}

export function removeField(field: FilterField | 'q', filter: TaskFilter): TaskFilter {
  const next = { ...filter };
  delete next[field];
  return next;
}

export function setValues(field: Exclude<FilterField, 'due'>, filter: TaskFilter, values: string[]): TaskFilter {
  if (values.length === 0) return removeField(field, filter);
  if (field === 'priority') {
    return { ...filter, priority: { op: filter.priority?.op ?? 'is', values: values as FilterPriority[] } };
  }
  if (field === 'labels') return { ...filter, labels: { op: filter.labels?.op ?? 'any', ids: values } };
  return { ...filter, [field]: { op: filter[field]?.op ?? 'is', ids: values } };
}

/**
 * Sets one end of the due range. The filter parser drops a range whose From is
 * after its To, so the end being set pulls the other one along rather than the
 * whole due filter silently disappearing.
 */
export function setDueRange(filter: TaskFilter, patch: { from?: string; to?: string }): TaskFilter {
  const due = filter.due;
  const next = { ...(due && !('preset' in due) ? due : {}), ...patch };
  if (!next.from) delete next.from;
  if (!next.to) delete next.to;
  if (next.from && next.to && next.from > next.to) {
    if (patch.from) next.to = next.from;
    else next.from = next.to;
  }
  return next.from || next.to ? { ...filter, due: next } : { ...filter, due: undefined };
}
