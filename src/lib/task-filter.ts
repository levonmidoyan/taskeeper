import { z } from 'zod';
import { isCalendarDay } from '@/lib/dates';

/**
 * The filter shared by the URL, the filter bar, saved views and the server
 * compiler (src/server/tasks/filter.ts). Client-safe: no db imports.
 * Values inside one field are OR'ed; fields are AND'ed.
 */

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type FilterPriority = (typeof PRIORITIES)[number];
export const TASK_STATES = ['open', 'done', 'all'] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const DUE_PRESETS = ['overdue', 'today', 'this_week', 'next_7d', 'none'] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];

type Op = 'is' | 'not';

export type TaskFilter = {
  state?: TaskState;
  status?: { op: Op; ids: string[] };
  priority?: { op: Op; values: FilterPriority[] };
  /** 'me' is the viewer, 'none' is unassigned; resolved at query time. */
  assignee?: { op: Op; ids: string[] };
  labels?: { op: 'any' | 'none'; ids: string[] };
  createdBy?: { op: Op; ids: string[] };
  due?: { preset: DuePreset } | { from?: string; to?: string };
  q?: string;
};

const MAX_IDS = 50;
const op = z.enum(['is', 'not']);
const ids = z.array(z.string().min(1).max(64)).max(MAX_IDS);
const day = z.string().refine(isCalendarDay, 'Not a calendar day.');

const schema = z.object({
  state: z.enum(TASK_STATES).optional(),
  status: z.object({ op, ids }).optional(),
  priority: z.object({ op, values: z.array(z.enum(PRIORITIES)).max(PRIORITIES.length) }).optional(),
  assignee: z.object({ op, ids }).optional(),
  labels: z.object({ op: z.enum(['any', 'none']), ids }).optional(),
  createdBy: z.object({ op, ids }).optional(),
  due: z.union([
    z.object({ preset: z.enum(DUE_PRESETS) }),
    z.object({ from: day.optional(), to: day.optional() }),
  ]).optional(),
  q: z.string().trim().max(200).optional(),
});

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Drops fields that would filter nothing, so equal filters look equal. */
function clean(raw: z.infer<typeof schema>): TaskFilter {
  const out: TaskFilter = {};
  if (raw.state) out.state = raw.state;
  if (raw.status?.ids.length) out.status = { op: raw.status.op, ids: unique(raw.status.ids) };
  if (raw.priority?.values.length) out.priority = { op: raw.priority.op, values: unique(raw.priority.values) };
  if (raw.assignee?.ids.length) out.assignee = { op: raw.assignee.op, ids: unique(raw.assignee.ids) };
  if (raw.labels?.ids.length) out.labels = { op: raw.labels.op, ids: unique(raw.labels.ids) };
  const creators = unique(raw.createdBy?.ids.filter((id) => id !== 'none') ?? []);
  if (raw.createdBy && creators.length) out.createdBy = { op: raw.createdBy.op, ids: creators };
  if (raw.due) {
    if ('preset' in raw.due) out.due = { preset: raw.due.preset };
    else {
      const { from, to } = raw.due;
      if ((from || to) && !(from && to && from > to)) out.due = { ...(from && { from }), ...(to && { to }) };
    }
  }
  if (raw.q) out.q = raw.q;
  return out;
}

export function parseTaskFilter(input: unknown): TaskFilter | null {
  const parsed = schema.safeParse(input);
  return parsed.success ? clean(parsed.data) : null;
}

export const FILTER_PARAM_KEYS = ['state', 'status', 'priority', 'assignee', 'labels', 'created', 'due', 'q'] as const;

export type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: ParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** 'a,b' → { op: 'is', ids }, '!a,b' → { op: negative, ids }. */
function list(value: string, negative: string) {
  const not = value.startsWith('!');
  const items = (not ? value.slice(1) : value).split(',').map((s) => s.trim()).filter(Boolean);
  return { op: not ? negative : 'is', items };
}

function field(params: ParamsLike, key: (typeof FILTER_PARAM_KEYS)[number]): Partial<Record<keyof TaskFilter, unknown>> {
  const value = read(params, key);
  if (value === undefined || value === '') return {};
  switch (key) {
    case 'state': return { state: value };
    case 'q': return { q: value };
    case 'priority': { const l = list(value, 'not'); return { priority: { op: l.op, values: l.items } }; }
    case 'status': { const l = list(value, 'not'); return { status: { op: l.op, ids: l.items } }; }
    case 'assignee': { const l = list(value, 'not'); return { assignee: { op: l.op, ids: l.items } }; }
    case 'created': { const l = list(value, 'not'); return { createdBy: { op: l.op, ids: l.items } }; }
    case 'labels': {
      const l = list(value, 'none');
      return { labels: { op: l.op === 'is' ? 'any' : 'none', ids: l.items } };
    }
    case 'due': {
      if (!value.includes('..')) return { due: { preset: value } };
      const [from, to] = value.split('..');
      return { due: { ...(from && { from }), ...(to && { to }) } };
    }
  }
}

/** Never throws: a field that doesn't parse is dropped and the rest kept. */
export function filterFromParams(params: ParamsLike): TaskFilter {
  let out: TaskFilter = {};
  for (const key of FILTER_PARAM_KEYS) {
    const one = parseTaskFilter(field(params, key));
    if (one) out = { ...out, ...one };
  }
  return out;
}

export function filterToParams(filter: TaskFilter): URLSearchParams {
  const p = new URLSearchParams();
  const neg = (not: boolean, items: string[]) => `${not ? '!' : ''}${items.join(',')}`;
  if (filter.state) p.set('state', filter.state);
  if (filter.status) p.set('status', neg(filter.status.op === 'not', filter.status.ids));
  if (filter.priority) p.set('priority', neg(filter.priority.op === 'not', filter.priority.values));
  if (filter.assignee) p.set('assignee', neg(filter.assignee.op === 'not', filter.assignee.ids));
  if (filter.labels) p.set('labels', neg(filter.labels.op === 'none', filter.labels.ids));
  if (filter.createdBy) p.set('created', neg(filter.createdBy.op === 'not', filter.createdBy.ids));
  if (filter.due) {
    p.set('due', 'preset' in filter.due ? filter.due.preset : `${filter.due.from ?? ''}..${filter.due.to ?? ''}`);
  }
  if (filter.q) p.set('q', filter.q);
  return p;
}

export function withDefaultState(filter: TaskFilter, state: TaskState): TaskFilter {
  return filter.state ? filter : { ...filter, state };
}

function canonical(filter: TaskFilter): string {
  const sorted = (xs: string[]) => [...new Set(xs)].sort();
  const c = clean(filter as z.infer<typeof schema>);
  return JSON.stringify([
    c.state ?? null,
    c.status ? [c.status.op, sorted(c.status.ids)] : null,
    c.priority ? [c.priority.op, sorted(c.priority.values)] : null,
    c.assignee ? [c.assignee.op, sorted(c.assignee.ids)] : null,
    c.labels ? [c.labels.op, sorted(c.labels.ids)] : null,
    c.createdBy ? [c.createdBy.op, sorted(c.createdBy.ids)] : null,
    c.due ?? null,
    c.q ?? null,
  ]);
}

export function sameFilter(a: TaskFilter, b: TaskFilter): boolean {
  return canonical(a) === canonical(b);
}

/** Anything set beyond the page's own default state. */
export function isFiltered(filter: TaskFilter, defaultState: TaskState): boolean {
  return !sameFilter(withDefaultState(filter, defaultState), { state: defaultState });
}

/** Board columns whose tasks this filter hides entirely (drives the "hidden by filter" toast). */
export function hiddenStatusIds(filter: TaskFilter, statuses: { id: string; isDone: boolean }[]): string[] {
  return statuses
    .filter((s) => {
      if (filter.status) {
        const listed = filter.status.ids.includes(s.id);
        if (filter.status.op === 'is' ? !listed : listed) return true;
      }
      if (filter.state === 'open' && s.isDone) return true;
      if (filter.state === 'done' && !s.isDone) return true;
      return false;
    })
    .map((s) => s.id);
}
