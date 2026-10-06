# Task filters + saved views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter Board, List, Calendar and a new All tasks page by status, priority, assignee, labels, due date, creator, open/done state and text, with the filter in the URL, and save the current filter + layout + sort as a named private or shared view.

**Architecture:** One client-safe Zod schema (`TaskFilter`) with a URL-params codec. One server compiler (`compileTaskFilter`) turns it into Drizzle `SQL` predicates that every task list query ANDs with its fixed tenancy predicates. A `saved_view` table stores the same JSON; a view's link is its layout route plus `?view=<id>` plus the view's filter as params, so the URL is always the whole truth and "modified" is a comparison of URL vs stored.

**Tech Stack:** Next.js 16 (App Router, server components, server actions), drizzle-orm 0.45 / drizzle-kit 0.31 on Postgres, zod 4.6, Align UI atoms (Popover, Dropdown, Modal, SegmentedControl, Switch, Input, Button, CompactButton, Badge), Tabler icons, sonner, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-saved-views-design.md`

## Global Constraints

- Filter fields exactly: `state`, `status`, `priority`, `assignee`, `labels`, `createdBy`, `due`, `q`. URL param names: `state`, `status`, `priority`, `assignee`, `labels`, `created`, `due`, `q`.
- `!` prefix on a param value = `not` (or `none` for labels). Values comma-separated. Due range `from..to`, either side optional.
- `state` default: Board → `all`; List, Calendar, All tasks → `open`. A query given a filter with no `state` applies no state predicate.
- Due presets exactly `overdue`, `today`, `this_week`, `next_7d`, `none`; computed from `todayInZone(ctx.timezone)`; `this_week` uses `getWeekStart(ctx)` (0 = Sunday).
- View name 1–60 chars (trimmed). `q` ≤ 200 chars. At most 50 ids per field.
- Project tabs show at most 5 saved views; the rest go in a "More views" dropdown.
- All tasks returns at most `500` rows; `truncated` when there are more.
- Write rule: owner always; workspace `owner`/`admin` may update/delete **shared** views. Private views are invisible to everyone but the owner.
- `ctx: WorkspaceContext` first on every `src/server/**` export; owner from `ctx.userId`, never input. Action files take a slug, never a ctx, and return `Result<T>` via `withAction`.
- Filters compile only through Drizzle builders and parameterised `sql` templates. No string interpolation into SQL.
- `src/lib/task-filter.ts` and `src/lib/views.ts` are client-safe: no imports from `src/db` or `src/server`.
- New table `saved_view` goes in the `TRUNCATE` list in `tests/setup/db.ts`.
- Dates stay `YYYY-MM-DD` strings through `src/lib/dates.ts`.
- Tabler icons only; semantic Align tokens only (no raw colors).
- Commits: Conventional Commits, plain messages, **no `Co-Authored-By` trailer**. Never push. Never change versions.
- Next.js here has breaking changes — check `node_modules/next/dist/docs/` before using any Next API not already used in the files you touch.
- Run `yarn db:setup:test` after the schema change before running server tests (and `yarn db:setup` for the dev DB).
- e2e must run on an alternate port (the user keeps `next dev` on :3000): temp Playwright config on :3100 with `BETTER_AUTH_URL=http://localhost:3100`.

## Plan decisions beyond the spec

1. **URL carries the whole filter.** The spec says "explicit filter params apply on top of the view". Implemented as: a view's link already contains the view's filter as params (`viewHref`), and the filter bar always writes `state`. A bare `?view=<id>` (no `state` param) redirects to `viewHref(view)`. So the server never merges; it reads the URL filter and compares it with the stored one. Same behaviour for the user, no merge rules, and clearing a field of a view works.
2. **Layout is fixed per view.** `updateView` patches name, shared, filter and sort. Changing layout = "Save as new" from another tab.
3. **All tasks uses a new read-only `WorkspaceTaskTable`**, not `TaskTable`. `TaskTable` is bound to one project (its statuses, bulk edit, localStorage key). Sorting for All tasks happens in SQL, because client sorting a 500-row cap would sort the wrong rows.
4. **Calendar gets a `{ workspace: true }` scope** for All tasks → Calendar.
5. **Due range uses two native date inputs** (`<input type="date">` in the Align Input atom), not the day-picker calendar: simpler, accessible, keyboard friendly.
6. **Built-in tabs (Board/List/Calendar) don't carry filters across**; clicking one starts unfiltered.

## Review Focus

1. **Clearing every filter of an open view** (URL ends up `?view=x&state=open`) — must show the cleared result marked Modified, not bounce back to the stored filter. Pinned in Task 3 (`resolveView` with `state` present and no other params → no redirect, `modified: true`).
2. **"Assignee is not me"** — must still return unassigned tasks (SQL `NOT IN` drops NULLs). Pinned in Task 2.
3. **Due presets near midnight in a far-east / far-west zone** — `today` must be the user's local day, not UTC's. Pinned in Task 2 (ctx.timezone `Pacific/Kiritimati` and `Pacific/Pago_Pago` at a fixed `now`).
4. **Hand-edited or stale URLs** (`?priority=nope`, `?due=2026-02-30..`, `?assignee=` empty, `?view=<other workspace's id>`) — bad field dropped, rest kept, never a 500; foreign view = "View not found". Pinned in Task 1 (codec) and Task 3 (`getView` across workspaces).
5. **A stored filter that no longer parses** (schema changed later, hand-edited row) — page renders unfiltered with the reset notice, Save rewrites it. Pinned in Task 3 (raw jsonb row `{"priority":{"op":"is","values":["nope"]}}`).

---

### Task 1: `TaskFilter` schema and URL codec

**Files:**
- Create: `src/lib/task-filter.ts`
- Test: `tests/unit/task-filter.test.ts`

**Interfaces:**
- Produces (client-safe):
  - `PRIORITIES`, `type FilterPriority`, `TASK_STATES`, `type TaskState`, `DUE_PRESETS`, `type DuePreset`
  - `type TaskFilter` (shape below)
  - `parseTaskFilter(input: unknown): TaskFilter | null` — null when the input doesn't parse
  - `FILTER_PARAM_KEYS: readonly string[]`
  - `type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>`
  - `filterFromParams(params: ParamsLike): TaskFilter` — never throws
  - `filterToParams(filter: TaskFilter): URLSearchParams`
  - `withDefaultState(filter: TaskFilter, state: TaskState): TaskFilter`
  - `sameFilter(a: TaskFilter, b: TaskFilter): boolean`
  - `isFiltered(filter: TaskFilter, defaultState: TaskState): boolean`
  - `hiddenStatusIds(filter: TaskFilter, statuses: { id: string; isDone: boolean }[]): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/task-filter.test.ts
import { describe, expect, it } from 'vitest';
import {
  filterFromParams, filterToParams, hiddenStatusIds, isFiltered, parseTaskFilter, sameFilter,
  withDefaultState, type TaskFilter,
} from '@/lib/task-filter';

describe('parseTaskFilter', () => {
  it('keeps valid fields and strips unknown keys', () => {
    expect(parseTaskFilter({ priority: { op: 'is', values: ['high'] }, junk: 1 }))
      .toEqual({ priority: { op: 'is', values: ['high'] } });
  });

  it('drops empty arrays, blank text and empty due ranges', () => {
    expect(parseTaskFilter({ assignee: { op: 'is', ids: [] }, q: '   ', due: {} })).toEqual({});
  });

  it('dedupes ids and trims text', () => {
    expect(parseTaskFilter({ labels: { op: 'any', ids: ['a', 'a', 'b'] }, q: '  deploy ' }))
      .toEqual({ labels: { op: 'any', ids: ['a', 'b'] }, q: 'deploy' });
  });

  it('rejects a bad value anywhere', () => {
    expect(parseTaskFilter({ priority: { op: 'is', values: ['nope'] } })).toBeNull();
    expect(parseTaskFilter({ due: { from: '2026-02-30' } })).toBeNull();
    expect(parseTaskFilter('not an object')).toBeNull();
  });

  it('drops "none" from createdBy (a task always had a creator when made)', () => {
    expect(parseTaskFilter({ createdBy: { op: 'is', ids: ['none'] } })).toEqual({});
  });

  it('drops a reversed due range', () => {
    expect(parseTaskFilter({ due: { from: '2026-10-10', to: '2026-10-01' } })).toEqual({});
  });
});

describe('filterFromParams / filterToParams', () => {
  it('reads every field', () => {
    const params = new URLSearchParams(
      'state=done&status=s1,s2&priority=high,urgent&assignee=!me,none&labels=!l1&created=me&due=overdue&q=deploy',
    );
    expect(filterFromParams(params)).toEqual({
      state: 'done',
      status: { op: 'is', ids: ['s1', 's2'] },
      priority: { op: 'is', values: ['high', 'urgent'] },
      assignee: { op: 'not', ids: ['me', 'none'] },
      labels: { op: 'none', ids: ['l1'] },
      createdBy: { op: 'is', ids: ['me'] },
      due: { preset: 'overdue' },
      q: 'deploy',
    });
  });

  it('reads due ranges with either side open', () => {
    expect(filterFromParams({ due: '2026-10-01..2026-10-31' })).toEqual({ due: { from: '2026-10-01', to: '2026-10-31' } });
    expect(filterFromParams({ due: '..2026-10-31' })).toEqual({ due: { to: '2026-10-31' } });
    expect(filterFromParams({ due: '2026-10-01..' })).toEqual({ due: { from: '2026-10-01' } });
  });

  it('drops only the bad field', () => {
    expect(filterFromParams({ priority: 'nope', q: 'x', due: '2026-02-30..', assignee: '' }))
      .toEqual({ q: 'x' });
  });

  it('takes the first value of a repeated param', () => {
    expect(filterFromParams({ q: ['a', 'b'] })).toEqual({ q: 'a' });
  });

  it('round-trips', () => {
    const filter: TaskFilter = {
      state: 'open',
      priority: { op: 'not', values: ['none'] },
      assignee: { op: 'is', ids: ['me', 'u1'] },
      labels: { op: 'any', ids: ['l1'] },
      due: { from: '2026-10-01' },
      q: 'a b',
    };
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
  });

  it('writes params in a fixed order', () => {
    expect(filterToParams({ q: 'x', state: 'all', priority: { op: 'is', values: ['low'] } }).toString())
      .toBe('state=all&priority=low&q=x');
  });
});

describe('helpers', () => {
  it('withDefaultState fills only a missing state', () => {
    expect(withDefaultState({}, 'open')).toEqual({ state: 'open' });
    expect(withDefaultState({ state: 'done' }, 'open')).toEqual({ state: 'done' });
  });

  it('sameFilter ignores array order and duplicates', () => {
    expect(sameFilter(
      { assignee: { op: 'is', ids: ['b', 'a'] }, state: 'open' },
      { state: 'open', assignee: { op: 'is', ids: ['a', 'b', 'a'] } },
    )).toBe(true);
    expect(sameFilter({ state: 'open' }, { state: 'all' })).toBe(false);
  });

  it('isFiltered is false for only the default state', () => {
    expect(isFiltered({ state: 'open' }, 'open')).toBe(false);
    expect(isFiltered({ state: 'all' }, 'open')).toBe(true);
    expect(isFiltered({ state: 'open', q: 'x' }, 'open')).toBe(true);
  });

  it('hiddenStatusIds covers status and state', () => {
    const statuses = [{ id: 'todo', isDone: false }, { id: 'doing', isDone: false }, { id: 'done', isDone: true }];
    expect(hiddenStatusIds({ status: { op: 'is', ids: ['todo'] } }, statuses)).toEqual(['doing', 'done']);
    expect(hiddenStatusIds({ status: { op: 'not', ids: ['todo'] } }, statuses)).toEqual(['todo']);
    expect(hiddenStatusIds({ state: 'open' }, statuses)).toEqual(['done']);
    expect(hiddenStatusIds({ state: 'done' }, statuses)).toEqual(['todo', 'doing']);
    expect(hiddenStatusIds({ state: 'all' }, statuses)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/unit/task-filter.test.ts`
Expected: FAIL — cannot resolve `@/lib/task-filter`.

- [ ] **Step 3: Implement**

```ts
// src/lib/task-filter.ts
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
```

Note: the `due: {}` case in `clean` drops an empty range, so `parseTaskFilter({ due: {} })` is `{}`. `canonical` re-runs `clean` (cheap) so unnormalised input still compares equal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/unit/task-filter.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-filter.ts tests/unit/task-filter.test.ts
git commit -m "feat(filters): TaskFilter schema and URL params codec"
```

---

### Task 2: Filter compiler and filtered task queries

**Files:**
- Create: `src/server/tasks/filter.ts`
- Modify: `src/server/tasks/search-query.ts` (add `likePattern`)
- Modify: `src/server/tasks/queries.ts` (`listProjectTasks` filter param; new `listWorkspaceTasks`; `searchTasks` uses `likePattern`)
- Modify: `src/server/tasks/calendar.ts` (filter param + `{ workspace: true }` scope)
- Test: `tests/server/task-filter.test.ts` (create)

**Interfaces:**
- Consumes: `TaskFilter`, `TaskState` from Task 1; `getWeekStart(ctx)` from `src/server/settings/queries.ts`; `TableSort`, `parseSortParam` from `src/lib/task-table-sort.ts`.
- Produces:
  - `likePattern(term: string): string` in `search-query.ts`
  - `type FilterScope = 'project' | 'workspace'`
  - `compileTaskFilter(ctx: WorkspaceContext, filter: TaskFilter, env: { scope: FilterScope; today: string; weekStart: number }): SQL[]`
  - `taskFilterSql(ctx: WorkspaceContext, filter: TaskFilter, scope: FilterScope, now?: Date): Promise<SQL[]>` (fetches week start only when `this_week` is used)
  - `listProjectTasks(ctx, projectId, filter: TaskFilter = {}): Promise<TaskRow[]>`
  - `type CalendarRange = { from: string; to: string } & ({ projectId: string } | { mine: true } | { workspace: true })`
  - `listCalendarTasks(ctx, range, filter: TaskFilter = {}): Promise<CalendarTask[]>`
  - `type WorkspaceTaskRow = { id; title; projectId; projectName; projectColor; statusName; statusColor; statusIcon: string | null; isDone: boolean; priority: Priority; assigneeName: string | null; assigneeImage: string | null; dueDate: string | null; createdAt: Date; updatedAt: Date }`
  - `listWorkspaceTasks(ctx, filter: TaskFilter, opts?: { sort?: TableSort | null; limit?: number }): Promise<{ tasks: WorkspaceTaskRow[]; truncated: boolean }>`
  - `WORKSPACE_TASK_LIMIT = 500`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/task-filter.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { task, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import type { TaskFilter } from '@/lib/task-filter';
import { createLabel } from '@/server/labels/service';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { compileTaskFilter, taskFilterSql } from '@/server/tasks/filter';
import { listProjectTasks, listWorkspaceTasks } from '@/server/tasks/queries';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('ada-f@example.com', 'Ada');
  const bob = await createUser('bob-f@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-f');
  await joinWorkspace(bob.id, ws.id, 'member');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-f', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const bobCtx: WorkspaceContext = { ...ctx, userId: bob.id, role: 'member' };
  const p = await createProject(ctx, { name: 'Web' });
  if (!p.ok) throw new Error(p.error);
  const project = (await getProject(ctx, p.data.id))!;
  return { ctx, bobCtx, ada, bob, ws, projectId: p.data.id, statuses: project.statuses };
}

type Add = Parameters<typeof createTask>[1];
async function add(ctx: WorkspaceContext, input: Add) {
  const made = await createTask(ctx, input);
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

const titles = async (ctx: WorkspaceContext, projectId: string, filter: TaskFilter) =>
  (await listProjectTasks(ctx, projectId, filter)).map((t) => t.title).sort();

describe('listProjectTasks with a filter', () => {
  it('no filter keeps today’s behaviour (done tasks included)', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'Open' });
    await add(ctx, { projectId, title: 'Closed', statusId: statuses.find((s) => s.isDone)!.id });
    expect(await titles(ctx, projectId, {})).toEqual(['Closed', 'Open']);
  });

  it('state open / done', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'Open' });
    await add(ctx, { projectId, title: 'Closed', statusId: statuses.find((s) => s.isDone)!.id });
    expect(await titles(ctx, projectId, { state: 'open' })).toEqual(['Open']);
    expect(await titles(ctx, projectId, { state: 'done' })).toEqual(['Closed']);
  });

  it('status is / not', async () => {
    const { ctx, projectId, statuses } = await setup();
    await add(ctx, { projectId, title: 'A', statusId: statuses[0].id });
    await add(ctx, { projectId, title: 'B', statusId: statuses[1].id });
    expect(await titles(ctx, projectId, { status: { op: 'is', ids: [statuses[0].id] } })).toEqual(['A']);
    expect(await titles(ctx, projectId, { status: { op: 'not', ids: [statuses[0].id] } })).toEqual(['B']);
  });

  it('priority is / not', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Hi', priority: 'high' });
    await add(ctx, { projectId, title: 'Lo', priority: 'low' });
    await add(ctx, { projectId, title: 'None' });
    expect(await titles(ctx, projectId, { priority: { op: 'is', values: ['high', 'low'] } })).toEqual(['Hi', 'Lo']);
    expect(await titles(ctx, projectId, { priority: { op: 'not', values: ['none'] } })).toEqual(['Hi', 'Lo']);
  });

  it('assignee me / none / user, and "not me" keeps unassigned', async () => {
    const { ctx, bob, projectId } = await setup();
    await add(ctx, { projectId, title: 'Mine', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Bob’s', assigneeId: bob.id });
    await add(ctx, { projectId, title: 'Nobody’s' });
    expect(await titles(ctx, projectId, { assignee: { op: 'is', ids: ['me'] } })).toEqual(['Mine']);
    expect(await titles(ctx, projectId, { assignee: { op: 'is', ids: ['none', bob.id] } })).toEqual(['Bob’s', 'Nobody’s']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['me'] } })).toEqual(['Bob’s', 'Nobody’s']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['none'] } })).toEqual(['Bob’s', 'Mine']);
    expect(await titles(ctx, projectId, { assignee: { op: 'not', ids: ['me', 'none'] } })).toEqual(['Bob’s']);
  });

  it('"me" means the caller', async () => {
    const { ctx, bobCtx, bob, projectId } = await setup();
    await add(ctx, { projectId, title: 'Mine', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Bob’s', assigneeId: bob.id });
    expect(await titles(bobCtx, projectId, { assignee: { op: 'is', ids: ['me'] } })).toEqual(['Bob’s']);
  });

  it('createdBy', async () => {
    const { ctx, bobCtx, projectId } = await setup();
    await add(ctx, { projectId, title: 'By Ada' });
    await add(bobCtx, { projectId, title: 'By Bob' });
    expect(await titles(ctx, projectId, { createdBy: { op: 'is', ids: ['me'] } })).toEqual(['By Ada']);
    expect(await titles(ctx, projectId, { createdBy: { op: 'not', ids: ['me'] } })).toEqual(['By Bob']);
  });

  it('labels any / none', async () => {
    const { ctx, projectId } = await setup();
    const bug = await createLabel(ctx, { name: 'bug' });
    const ui = await createLabel(ctx, { name: 'ui' });
    if (!bug.ok || !ui.ok) throw new Error();
    await add(ctx, { projectId, title: 'Bug', labelIds: [bug.data.id] });
    await add(ctx, { projectId, title: 'Both', labelIds: [bug.data.id, ui.data.id] });
    await add(ctx, { projectId, title: 'Plain' });
    expect(await titles(ctx, projectId, { labels: { op: 'any', ids: [ui.data.id, bug.data.id] } })).toEqual(['Both', 'Bug']);
    expect(await titles(ctx, projectId, { labels: { op: 'none', ids: [ui.data.id] } })).toEqual(['Bug', 'Plain']);
  });

  it('due range and none', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 1', dueDate: '2026-10-01' });
    await add(ctx, { projectId, title: 'Oct 9', dueDate: '2026-10-09' });
    await add(ctx, { projectId, title: 'Undated' });
    expect(await titles(ctx, projectId, { due: { from: '2026-10-01', to: '2026-10-05' } })).toEqual(['Oct 1']);
    expect(await titles(ctx, projectId, { due: { from: '2026-10-05' } })).toEqual(['Oct 9']);
    expect(await titles(ctx, projectId, { due: { preset: 'none' } })).toEqual(['Undated']);
  });

  it('text matches title and description prefixes and odd tokens', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Deployment checklist' });
    await add(ctx, { projectId, title: 'Other', description: 'deploy the api' });
    await add(ctx, { projectId, title: 'Grow 50% faster' });
    expect(await titles(ctx, projectId, { q: 'deplo' })).toEqual(['Deployment checklist', 'Other']);
    expect(await titles(ctx, projectId, { q: '50%' })).toEqual(['Grow 50% faster']);
  });

  it('fields combine with AND', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Hit', priority: 'high', assigneeId: ctx.userId });
    await add(ctx, { projectId, title: 'Wrong person', priority: 'high' });
    await add(ctx, { projectId, title: 'Wrong priority', assigneeId: ctx.userId });
    expect(await titles(ctx, projectId, {
      priority: { op: 'is', values: ['high'] }, assignee: { op: 'is', ids: ['me'] },
    })).toEqual(['Hit']);
  });

  it('a stale id matches nothing and does not throw', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'A' });
    expect(await titles(ctx, projectId, { labels: { op: 'any', ids: ['gone'] } })).toEqual([]);
  });
});

describe('due presets in the caller’s zone', () => {
  // 2026-10-04T11:30Z is already Oct 5 in Kiritimati (UTC+14) and still Oct 4 in Pago Pago (UTC-11).
  const now = new Date('2026-10-04T11:30:00Z');

  async function dueTitles(ctx: WorkspaceContext, projectId: string, preset: 'overdue' | 'today' | 'this_week' | 'next_7d') {
    const where = await taskFilterSql(ctx, { due: { preset } }, 'project', now);
    // Only the filter predicates plus the project, to isolate the compiler.
    const rows = await db.select({ title: task.title }).from(task).where(and(eq(task.projectId, projectId), ...where));
    return rows.map((r) => r.title).sort();
  }

  it('today / overdue follow ctx.timezone', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Oct 5', dueDate: '2026-10-05' });
    const east = { ...ctx, timezone: 'Pacific/Kiritimati' };
    const west = { ...ctx, timezone: 'Pacific/Pago_Pago' };
    expect(await dueTitles(east, projectId, 'today')).toEqual(['Oct 5']);
    expect(await dueTitles(east, projectId, 'overdue')).toEqual(['Oct 4']);
    expect(await dueTitles(west, projectId, 'today')).toEqual(['Oct 4']);
    expect(await dueTitles(west, projectId, 'overdue')).toEqual([]);
  });

  it('next_7d is today through today + 6', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Oct 10', dueDate: '2026-10-10' });
    await add(ctx, { projectId, title: 'Oct 11', dueDate: '2026-10-11' });
    expect(await dueTitles(ctx, projectId, 'next_7d')).toEqual(['Oct 10', 'Oct 4']);
  });

  it('this_week follows the workspace week start', async () => {
    // 2026-10-04 is a Sunday.
    const { ctx, ws, projectId } = await setup();
    await add(ctx, { projectId, title: 'Sat Oct 3', dueDate: '2026-10-03' });
    await add(ctx, { projectId, title: 'Sun Oct 4', dueDate: '2026-10-04' });
    await add(ctx, { projectId, title: 'Mon Oct 5', dueDate: '2026-10-05' });
    await db.update(workspaceSettings).set({ weekStart: 1 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await dueTitles(ctx, projectId, 'this_week')).toEqual(['Sat Oct 3', 'Sun Oct 4']); // Mon Sep 28 – Sun Oct 4
    await db.update(workspaceSettings).set({ weekStart: 0 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await dueTitles(ctx, projectId, 'this_week')).toEqual(['Mon Oct 5', 'Sun Oct 4']); // Sun Oct 4 – Sat Oct 10
  });
});

describe('compileTaskFilter', () => {
  it('ignores status in workspace scope', async () => {
    const { ctx } = await setup();
    const sql = compileTaskFilter(ctx, { status: { op: 'is', ids: ['x'] } }, { scope: 'workspace', today: '2026-10-04', weekStart: 1 });
    expect(sql).toEqual([]);
  });
});

describe('listWorkspaceTasks', () => {
  it('spans active projects only, with project and status columns', async () => {
    const { ctx, projectId } = await setup();
    const other = await createProject(ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(ctx, { projectId, title: 'Web task' });
    await add(ctx, { projectId: other.data.id, title: 'App task' });
    let res = await listWorkspaceTasks(ctx, {});
    expect(res.tasks.map((t) => t.title).sort()).toEqual(['App task', 'Web task']);
    expect(res.tasks.find((t) => t.title === 'Web task')).toMatchObject({ projectName: 'Web', statusName: 'Todo', isDone: false });

    await archiveProject(ctx, { projectId: other.data.id });
    res = await listWorkspaceTasks(ctx, {});
    expect(res.tasks.map((t) => t.title)).toEqual(['Web task']);
  });

  it('never returns another workspace’s tasks, even when a filter names its ids', async () => {
    const { ctx, projectId } = await setup();
    const eve = await createUser('eve-f@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-f2');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-f2', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    const p2 = await createProject(eveCtx, { name: 'Secret' });
    if (!p2.ok) throw new Error();
    await add(eveCtx, { projectId: p2.data.id, title: 'Secret task', assigneeId: eve.id });
    await add(ctx, { projectId, title: 'Mine' });
    const res = await listWorkspaceTasks(ctx, { assignee: { op: 'is', ids: [eve.id] } });
    expect(res.tasks).toEqual([]);
  });

  it('caps rows and reports truncation', async () => {
    const { ctx, projectId } = await setup();
    for (const t of ['A', 'B', 'C']) await add(ctx, { projectId, title: t });
    const res = await listWorkspaceTasks(ctx, {}, { limit: 2 });
    expect(res.tasks).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect((await listWorkspaceTasks(ctx, {}, { limit: 3 })).truncated).toBe(false);
  });

  it('sorts in SQL: due nulls last by default, priority by rank, title desc', async () => {
    const { ctx, projectId } = await setup();
    await add(ctx, { projectId, title: 'b', dueDate: '2026-10-09', priority: 'low' });
    await add(ctx, { projectId, title: 'a', priority: 'urgent' });
    await add(ctx, { projectId, title: 'c', dueDate: '2026-10-01', priority: 'medium' });
    const order = async (sort: Parameters<typeof listWorkspaceTasks>[2]) =>
      (await listWorkspaceTasks(ctx, {}, sort)).tasks.map((t) => t.title);
    expect(await order({})).toEqual(['c', 'b', 'a']);
    expect(await order({ sort: { id: 'priority', desc: false } })).toEqual(['a', 'c', 'b']);
    expect(await order({ sort: { id: 'title', desc: true } })).toEqual(['c', 'b', 'a']);
    expect(await order({ sort: { id: 'due', desc: true } })).toEqual(['b', 'c', 'a']);
  });
});

describe('listCalendarTasks with a filter', () => {
  it('workspace scope spans projects and applies the filter', async () => {
    const { ctx, projectId } = await setup();
    const other = await createProject(ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(ctx, { projectId, title: 'Hi', dueDate: '2026-10-02', priority: 'high' });
    await add(ctx, { projectId: other.data.id, title: 'Hi 2', dueDate: '2026-10-03', priority: 'high' });
    await add(ctx, { projectId, title: 'Lo', dueDate: '2026-10-02', priority: 'low' });
    const rows = await listCalendarTasks(
      ctx, { from: '2026-09-28', to: '2026-11-08', workspace: true }, { priority: { op: 'is', values: ['high'] } },
    );
    expect(rows.map((r) => r.title)).toEqual(['Hi', 'Hi 2']);
  });
});
```

Archived tasks and projects in the calendar are already covered by `tests/server/calendar.test.ts`; leave those tests untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/task-filter.test.ts`
Expected: FAIL — cannot resolve `@/server/tasks/filter`.

- [ ] **Step 3: Add `likePattern` and use it in `searchTasks`**

In `src/server/tasks/search-query.ts` append:

```ts
/** An ILIKE pattern matching `term` anywhere, with LIKE's own wildcards escaped. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
```

In `src/server/tasks/queries.ts` `searchTasks`, replace
`const pattern = \`%${term.replace(/[\\%_]/g, (c) => \`\\${c}\`)}%\`;` with `const pattern = likePattern(term);` and import `likePattern` alongside `plainSnippet, toPrefixQuery`.

- [ ] **Step 4: Write the compiler**

```ts
// src/server/tasks/filter.ts
import { and, eq, exists, gte, ilike, inArray, isNotNull, isNull, lt, lte, not, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db, task, taskLabel, taskStatus } from '@/db';
import { addDays, todayInZone } from '@/lib/dates';
import type { WorkspaceContext } from '@/lib/session';
import type { TaskFilter } from '@/lib/task-filter';
import { getWeekStart } from '@/server/settings/queries';
import { likePattern, toPrefixQuery } from './search-query';

export type FilterScope = 'project' | 'workspace';

/** 'me' → the caller; 'none' → unassigned. "not" keeps NULLs unless 'none' is listed. */
function personPredicate(ctx: WorkspaceContext, col: PgColumn, op: 'is' | 'not', ids: string[]): SQL | undefined {
  const concrete = ids.filter((id) => id !== 'none').map((id) => (id === 'me' ? ctx.userId : id));
  const none = ids.includes('none');
  if (op === 'is') {
    return or(concrete.length ? inArray(col, concrete) : undefined, none ? isNull(col) : undefined);
  }
  if (none) return and(isNotNull(col), concrete.length ? notInArray(col, concrete) : undefined);
  return or(isNull(col), notInArray(col, concrete));
}

function weekStartOf(today: string, weekStart: number): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((dow - weekStart + 7) % 7));
}

/**
 * The filter as SQL predicates to AND with a query's fixed ones (workspace,
 * not archived, …). Pure: `today` and `weekStart` come from the caller.
 * Every value reaches Postgres as a bound parameter.
 */
export function compileTaskFilter(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  env: { scope: FilterScope; today: string; weekStart: number },
): SQL[] {
  const out: (SQL | undefined)[] = [];

  if (filter.state && filter.state !== 'all') {
    const done = exists(
      db.select({ one: sql`1` }).from(taskStatus)
        .where(and(eq(taskStatus.id, task.statusId), eq(taskStatus.isDone, true))),
    );
    out.push(filter.state === 'done' ? done : not(done));
  }

  // Statuses belong to one project; across projects the field means nothing.
  if (filter.status && env.scope === 'project') {
    out.push(filter.status.op === 'is' ? inArray(task.statusId, filter.status.ids) : notInArray(task.statusId, filter.status.ids));
  }

  if (filter.priority) {
    out.push(filter.priority.op === 'is'
      ? inArray(task.priority, filter.priority.values)
      : notInArray(task.priority, filter.priority.values));
  }

  if (filter.assignee) out.push(personPredicate(ctx, task.assigneeId, filter.assignee.op, filter.assignee.ids));
  if (filter.createdBy) out.push(personPredicate(ctx, task.createdBy, filter.createdBy.op, filter.createdBy.ids));

  if (filter.labels) {
    const has = exists(
      db.select({ one: sql`1` }).from(taskLabel)
        .where(and(eq(taskLabel.taskId, task.id), inArray(taskLabel.labelId, filter.labels.ids))),
    );
    out.push(filter.labels.op === 'any' ? has : not(has));
  }

  if (filter.due) {
    const { today } = env;
    if ('preset' in filter.due) {
      switch (filter.due.preset) {
        case 'overdue': out.push(lt(task.dueDate, today)); break;
        case 'today': out.push(eq(task.dueDate, today)); break;
        case 'next_7d': out.push(gte(task.dueDate, today), lte(task.dueDate, addDays(today, 6))); break;
        case 'this_week': {
          const start = weekStartOf(today, env.weekStart);
          out.push(gte(task.dueDate, start), lte(task.dueDate, addDays(start, 6)));
          break;
        }
        case 'none': out.push(isNull(task.dueDate)); break;
      }
    } else {
      if (filter.due.from) out.push(gte(task.dueDate, filter.due.from));
      if (filter.due.to) out.push(lte(task.dueDate, filter.due.to));
    }
  }

  if (filter.q) {
    // The ⌘K palette's matching: word prefixes in title or description, or a title substring.
    const prefix = toPrefixQuery(filter.q);
    const title = ilike(task.title, likePattern(filter.q));
    out.push(prefix ? or(sql`${task.search} @@ to_tsquery('english', ${prefix})`, title) : title);
  }

  return out.filter((p): p is SQL => p !== undefined);
}

/** compileTaskFilter with today in the caller's zone; reads the week start only when needed. */
export async function taskFilterSql(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  scope: FilterScope,
  now: Date = new Date(),
): Promise<SQL[]> {
  const needsWeek = !!filter.due && 'preset' in filter.due && filter.due.preset === 'this_week';
  const weekStart = needsWeek ? await getWeekStart(ctx) : 1;
  return compileTaskFilter(ctx, filter, { scope, today: todayInZone(ctx.timezone, now), weekStart });
}
```

- [ ] **Step 5: Thread the filter into `listProjectTasks` and add `listWorkspaceTasks`**

In `src/server/tasks/queries.ts`:

```ts
// imports: add `asc` to the drizzle-orm import, plus:
import type { TaskFilter } from '@/lib/task-filter';
import type { TableSort } from '@/lib/task-table-sort';
import { taskFilterSql } from './filter';

/** Top-level tasks of one project, board order. Subtasks are loaded with their parent. */
export async function listProjectTasks(
  ctx: WorkspaceContext,
  projectId: string,
  filter: TaskFilter = {},
): Promise<TaskRow[]> {
  const filters = await taskFilterSql(ctx, filter, 'project');
  const rows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.projectId, projectId),
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.parentTaskId),
        ...filters,
      ),
    )
    .orderBy(byKey(task.position), byId(task.id));

  return attachLabels(rows);
}
```

Append after `listProjectTasks`:

```ts
export const WORKSPACE_TASK_LIMIT = 500;

export type WorkspaceTaskRow = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  statusName: string;
  statusColor: string;
  statusIcon: string | null;
  isDone: boolean;
  priority: Priority;
  assigneeName: string | null;
  assigneeImage: string | null;
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const PRIORITY_ORDER = sql`case ${task.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;

function workspaceOrder(sort: TableSort | null | undefined): SQL[] {
  if (!sort) return [sql`${task.dueDate} asc nulls last`, asc(task.createdAt), asc(task.id)];
  const dir = sql.raw(sort.desc ? 'desc' : 'asc');
  const key = {
    title: sql`lower(${task.title})`,
    status: sql`lower(${taskStatus.name})`,
    priority: PRIORITY_ORDER,
    assignee: sql`lower(${user.name})`,
    due: sql`${task.dueDate}`,
    created: sql`${task.createdAt}`,
    updated: sql`${task.updatedAt}`,
  }[sort.id];
  // Missing assignees and due dates sink to the bottom either way, as in the List.
  return [sql`${key} ${dir} nulls last`, asc(task.id)];
}

/**
 * Top-level tasks across every active project, for the All tasks page. Sorted
 * in SQL: with a row cap, sorting on the client would sort the wrong rows.
 */
export async function listWorkspaceTasks(
  ctx: WorkspaceContext,
  filter: TaskFilter,
  opts: { sort?: TableSort | null; limit?: number } = {},
): Promise<{ tasks: WorkspaceTaskRow[]; truncated: boolean }> {
  const limit = opts.limit ?? WORKSPACE_TASK_LIMIT;
  const filters = await taskFilterSql(ctx, filter, 'workspace');
  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
      statusName: taskStatus.name,
      statusColor: taskStatus.color,
      statusIcon: taskStatus.icon,
      isDone: taskStatus.isDone,
      priority: task.priority,
      assigneeName: user.name,
      assigneeImage: user.image,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.parentTaskId),
        isNull(project.archivedAt),
        ...filters,
      ),
    )
    .orderBy(...workspaceOrder(opts.sort))
    .limit(limit + 1);

  return { tasks: rows.slice(0, limit), truncated: rows.length > limit };
}
```

Check `SQL` is imported as a type from `drizzle-orm` (`import { …, type SQL } from 'drizzle-orm'`).

- [ ] **Step 6: Calendar filter + workspace scope**

In `src/server/tasks/calendar.ts`:

```ts
import type { TaskFilter } from '@/lib/task-filter';
import { taskFilterSql } from './filter';

export type CalendarRange = { from: string; to: string } & ({ projectId: string } | { mine: true } | { workspace: true });

export async function listCalendarTasks(
  ctx: WorkspaceContext,
  range: CalendarRange,
  filter: TaskFilter = {},
): Promise<CalendarTask[]> {
  // …range validation unchanged…
  const scope = 'projectId' in range
    ? eq(task.projectId, range.projectId)
    : 'mine' in range ? eq(task.assigneeId, ctx.userId) : undefined;
  const filters = await taskFilterSql(ctx, filter, 'projectId' in range ? 'project' : 'workspace');
  // …select unchanged; in `and(...)` keep `scope` and append `...filters`…
}
```

Update the doc comment: "for one project, for "my calendar" (assigned to me), or for the whole workspace (All tasks)".

- [ ] **Step 7: Run tests**

Run: `yarn vitest run tests/server/task-filter.test.ts tests/server/calendar.test.ts tests/server/tasks.test.ts tests/unit/search-query.test.ts`
Expected: PASS. Then `yarn tsc --noEmit` — expected clean.

- [ ] **Step 8: Commit**

```bash
git add src/server/tasks tests/server/task-filter.test.ts
git commit -m "feat(filters): compile TaskFilter to SQL for project, calendar and workspace task lists"
```

---

### Task 3: `saved_view` table, views service, and view resolution

**Files:**
- Create: `src/db/schema/view.ts`
- Modify: `src/db/schema/index.ts` (export `./view`)
- Modify: `tests/setup/db.ts` (TRUNCATE `saved_view`)
- Create: `src/lib/views.ts` (client-safe)
- Create: `src/server/views/queries.ts`, `src/server/views/service.ts`, `src/server/views/actions.ts`, `src/server/views/resolve.ts`
- Test: `tests/unit/views.test.ts`, `tests/server/views.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TaskFilter`, `parseTaskFilter`, `filterFromParams`, `filterToParams`, `withDefaultState`, `sameFilter`, `TaskState`, `ParamsLike`); `parseSortParam`, `formatSortParam` from `src/lib/task-table-sort.ts`.
- Produces:
  - `src/lib/views.ts`: `VIEW_LAYOUTS = ['board','list','calendar'] as const`, `type ViewLayout`, `defaultState(layout: ViewLayout): TaskState`, `type ViewRef = { id: string; projectId: string | null; layout: ViewLayout; filter: TaskFilter; sort: string | null }`, `viewHref(workspaceSlug: string, view: ViewRef): string`, `layoutPath(workspaceSlug: string, projectId: string | null, layout: ViewLayout): string`, `MAX_VIEW_TABS = 5`
  - `src/server/views/queries.ts`: `type SavedView = ViewRef & { name: string; shared: boolean; ownerId: string; mine: boolean; canEdit: boolean; filterReset: boolean; createdAt: Date }`, `listViews(ctx, scope: { projectId: string } | { workspace: true }): Promise<SavedView[]>`, `getView(ctx, id: string): Promise<SavedView | null>`
  - `src/server/views/service.ts`: `createView(ctx, input: { projectId?: string | null; name: string; shared?: boolean; layout: ViewLayout; filter: unknown; sort?: string | null }): Promise<Result<{ id: string }>>`, `updateView(ctx, input: { id: string; name?: string; shared?: boolean; filter?: unknown; sort?: string | null }): Promise<Result<null>>`, `duplicateView(ctx, input: { id: string; name?: string }): Promise<Result<{ id: string }>>`, `deleteView(ctx, input: { id: string }): Promise<Result<null>>`
  - `src/server/views/actions.ts`: `createViewAction(slug, input)`, `updateViewAction(slug, input)`, `duplicateViewAction(slug, input)`, `deleteViewAction(slug, input)` — same input types, same `Result`s
  - `src/server/views/resolve.ts`: `type ResolvedView = { filter: TaskFilter; sort: string | null; view: SavedView | null; modified: boolean; viewMissing: boolean }`, `resolveView(ctx, params: ParamsLike, at: { layout: ViewLayout; projectId: string | null }): Promise<ResolvedView | { redirect: string }>`

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/unit/views.test.ts
import { describe, expect, it } from 'vitest';
import { defaultState, layoutPath, viewHref } from '@/lib/views';

describe('views helpers', () => {
  it('defaultState: board shows all, the rest open', () => {
    expect(defaultState('board')).toBe('all');
    expect(defaultState('list')).toBe('open');
    expect(defaultState('calendar')).toBe('open');
  });

  it('layoutPath', () => {
    expect(layoutPath('acme', 'p1', 'board')).toBe('/acme/projects/p1');
    expect(layoutPath('acme', 'p1', 'list')).toBe('/acme/projects/p1/list');
    expect(layoutPath('acme', 'p1', 'calendar')).toBe('/acme/projects/p1/calendar');
    expect(layoutPath('acme', null, 'list')).toBe('/acme/tasks');
    expect(layoutPath('acme', null, 'calendar')).toBe('/acme/tasks?layout=calendar');
  });

  it('viewHref always carries state, the filter, and a list sort', () => {
    expect(viewHref('acme', { id: 'v1', projectId: 'p1', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' }))
      .toBe('/acme/projects/p1/list?view=v1&state=open&q=x&sort=due.asc');
    expect(viewHref('acme', { id: 'v2', projectId: 'p1', layout: 'board', filter: {}, sort: 'due.asc' }))
      .toBe('/acme/projects/p1?view=v2&state=all');
    expect(viewHref('acme', { id: 'v3', projectId: null, layout: 'calendar', filter: { state: 'done' }, sort: null }))
      .toBe('/acme/tasks?layout=calendar&view=v3&state=done');
  });
});
```

- [ ] **Step 2: Implement `src/lib/views.ts`**

```ts
// src/lib/views.ts
import { filterToParams, withDefaultState, type TaskFilter, type TaskState } from '@/lib/task-filter';

export const VIEW_LAYOUTS = ['board', 'list', 'calendar'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

/** Project tabs show this many saved views; the rest go under "More views". */
export const MAX_VIEW_TABS = 5;

/** The Board has a done column, so it shows everything; lists hide finished work. */
export function defaultState(layout: ViewLayout): TaskState {
  return layout === 'board' ? 'all' : 'open';
}

export type ViewRef = {
  id: string;
  projectId: string | null;
  layout: ViewLayout;
  filter: TaskFilter;
  sort: string | null;
};

export function layoutPath(workspaceSlug: string, projectId: string | null, layout: ViewLayout): string {
  if (!projectId) return `/${workspaceSlug}/tasks${layout === 'calendar' ? '?layout=calendar' : ''}`;
  const base = `/${workspaceSlug}/projects/${projectId}`;
  return layout === 'board' ? base : `${base}/${layout}`;
}

/**
 * A view's link: its page plus its whole filter, so the URL alone reproduces it
 * and "modified" is just URL vs stored. `state` is always present — a bare
 * `?view=` (no state) is how the page knows to load the stored filter.
 */
export function viewHref(workspaceSlug: string, view: ViewRef): string {
  const path = layoutPath(workspaceSlug, view.projectId, view.layout);
  const [pathname, existing] = path.split('?');
  const params = new URLSearchParams(existing);
  params.set('view', view.id);
  for (const [k, v] of filterToParams(withDefaultState(view.filter, defaultState(view.layout)))) params.set(k, v);
  if (view.layout === 'list' && view.sort) params.set('sort', view.sort);
  return `${pathname}?${params.toString()}`;
}
```

Run: `yarn vitest run tests/unit/views.test.ts` — expected PASS.

- [ ] **Step 3: Schema**

```ts
// src/db/schema/view.ts
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { project } from './project';

/**
 * A named filter + layout + sort. project_id null = a workspace view (All tasks).
 * `filter` is a TaskFilter (src/lib/task-filter.ts), parsed with Zod on every read
 * and write; it is never interpolated into SQL.
 */
export const savedView = pgTable(
  'saved_view',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shared: boolean('shared').notNull().default(false),
    layout: text('layout').notNull(),
    filter: jsonb('filter').notNull().default(sql`'{}'::jsonb`),
    sort: text('sort'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saved_view_scope_idx').on(t.workspaceId, t.projectId),
    check('saved_view_layout_ck', sql`${t.layout} in ('board', 'list', 'calendar')`),
    check('saved_view_board_project_ck', sql`${t.layout} <> 'board' or ${t.projectId} is not null`),
  ],
);
```

Add `export * from './view';` to `src/db/schema/index.ts`. Add `saved_view,` at the start of the TRUNCATE list in `tests/setup/db.ts` (first line becomes `notification, reminder, saved_view,`).

Run: `yarn db:setup:test && yarn db:setup` — expected: drizzle-kit push creates `saved_view`.

- [ ] **Step 4: Write the failing server tests**

```ts
// tests/server/views.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { savedView } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getView, listViews } from '@/server/views/queries';
import { resolveView } from '@/server/views/resolve';
import { createView, deleteView, duplicateView, updateView } from '@/server/views/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('ada-v@example.com', 'Ada');   // owner
  const bob = await createUser('bob-v@example.com', 'Bob');   // member
  const cy = await createUser('cy-v@example.com', 'Cy');      // admin
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-v');
  await joinWorkspace(bob.id, ws.id, 'member');
  await joinWorkspace(cy.id, ws.id, 'admin');
  const base = { workspaceId: ws.id, slug: 'ws-v', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const ctx: WorkspaceContext = { ...base, userId: ada.id, role: 'owner' };
  const bobCtx: WorkspaceContext = { ...base, userId: bob.id, role: 'member' };
  const cyCtx: WorkspaceContext = { ...base, userId: cy.id, role: 'admin' };
  const p = await createProject(ctx, { name: 'Web' });
  if (!p.ok) throw new Error();
  return { ctx, bobCtx, cyCtx, ws, projectId: p.data.id };
}

async function make(ctx: WorkspaceContext, input: Parameters<typeof createView>[1]) {
  const r = await createView(ctx, input);
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe('createView', () => {
  it('stores a cleaned filter, owner from ctx, private by default', async () => {
    const { bobCtx, projectId } = await setup();
    const id = await make(bobCtx, {
      projectId, name: '  Mine  ', layout: 'list',
      filter: { assignee: { op: 'is', ids: ['me', 'me'] }, junk: 1 }, sort: 'due.asc',
    });
    const view = await getView(bobCtx, id);
    expect(view).toMatchObject({
      name: 'Mine', shared: false, layout: 'list', mine: true, canEdit: true,
      filter: { assignee: { op: 'is', ids: ['me'] } }, sort: 'due.asc', filterReset: false,
    });
  });

  it('validates name, filter, layout and project', async () => {
    const { ctx, projectId } = await setup();
    expect(await createView(ctx, { projectId, name: ' ', layout: 'list', filter: {} })).toMatchObject({ ok: false });
    expect(await createView(ctx, { projectId, name: 'x'.repeat(61), layout: 'list', filter: {} })).toMatchObject({ ok: false });
    expect(await createView(ctx, { projectId, name: 'Bad', layout: 'list', filter: { priority: { op: 'is', values: ['nope'] } } }))
      .toEqual({ ok: false, error: 'That filter is not valid.' });
    expect(await createView(ctx, { projectId: null, name: 'Board', layout: 'board', filter: {} }))
      .toEqual({ ok: false, error: 'A board view needs a project.' });
    expect(await createView(ctx, { projectId: 'nope', name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
    await archiveProject(ctx, { projectId });
    expect(await createView(ctx, { projectId, name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
  });

  it('keeps sort for list views only, and drops a malformed sort', async () => {
    const { ctx, projectId } = await setup();
    const board = await make(ctx, { projectId, name: 'B', layout: 'board', filter: {}, sort: 'due.asc' });
    const list = await make(ctx, { projectId, name: 'L', layout: 'list', filter: {}, sort: 'nope.up' });
    expect((await getView(ctx, board))!.sort).toBeNull();
    expect((await getView(ctx, list))!.sort).toBeNull();
  });

  it('rejects a project from another workspace', async () => {
    const { ctx } = await setup();
    const eve = await createUser('eve-v@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-v2');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-v2', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    const p2 = await createProject(eveCtx, { name: 'Secret' });
    if (!p2.ok) throw new Error();
    expect(await createView(ctx, { projectId: p2.data.id, name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
  });
});

describe('visibility and permissions', () => {
  it('lists own + shared in scope; private views are invisible to others, admins included', async () => {
    const { ctx, bobCtx, cyCtx, projectId } = await setup();
    await make(bobCtx, { projectId, name: 'Bob private', layout: 'list', filter: {} });
    await make(bobCtx, { projectId, name: 'Bob shared', layout: 'list', filter: {}, shared: true });
    await make(ctx, { projectId: null, name: 'Ada workspace', layout: 'list', filter: {}, shared: true });

    expect((await listViews(bobCtx, { projectId })).map((v) => v.name)).toEqual(['Bob private', 'Bob shared']);
    expect((await listViews(cyCtx, { projectId })).map((v) => v.name)).toEqual(['Bob shared']);
    expect((await listViews(bobCtx, { workspace: true })).map((v) => v.name)).toEqual(['Ada workspace']);
  });

  it('permission matrix for update/delete', async () => {
    const { ctx, bobCtx, cyCtx, projectId } = await setup();
    const priv = await make(bobCtx, { projectId, name: 'P', layout: 'list', filter: {} });
    const shared = await make(bobCtx, { projectId, name: 'S', layout: 'list', filter: {}, shared: true });
    const adaShared = await make(ctx, { projectId, name: 'A', layout: 'list', filter: {}, shared: true });

    // Private: only the owner; others get "not found", not "forbidden".
    expect(await updateView(cyCtx, { id: priv, name: 'x' })).toEqual({ ok: false, error: 'View not found.' });
    expect(await deleteView(ctx, { id: priv })).toEqual({ ok: false, error: 'View not found.' });
    expect(await updateView(bobCtx, { id: priv, name: 'P2' })).toEqual({ ok: true, data: null });

    // Shared: owner, workspace admin and owner may change; another member may not.
    expect(await updateView(cyCtx, { id: shared, name: 'S2' })).toEqual({ ok: true, data: null });
    expect(await updateView(ctx, { id: shared, shared: false })).toEqual({ ok: true, data: null });
    expect(await updateView(bobCtx, { id: adaShared, name: 'x' }))
      .toEqual({ ok: false, error: 'Only the owner or a workspace admin can change this view.' });
    expect((await getView(bobCtx, adaShared))!.canEdit).toBe(false);
    expect((await getView(cyCtx, adaShared))!.canEdit).toBe(true);
    expect(await deleteView(bobCtx, { id: adaShared })).toMatchObject({ ok: false });
    expect(await deleteView(cyCtx, { id: adaShared })).toEqual({ ok: true, data: null });
    expect(await getView(ctx, adaShared)).toBeNull();
  });

  it('getView hides other workspaces’ views', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'Shared', layout: 'list', filter: {}, shared: true });
    const eve = await createUser('eve-v2@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-v3');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-v3', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    expect(await getView(eveCtx, id)).toBeNull();
    expect(await deleteView(eveCtx, { id })).toEqual({ ok: false, error: 'View not found.' });
  });

  it('archived project hides its views', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    await archiveProject(ctx, { projectId });
    expect(await listViews(ctx, { projectId })).toEqual([]);
    expect(await getView(ctx, id)).toBeNull();
  });
});

describe('updateView / duplicateView', () => {
  it('update re-validates the filter and keeps layout', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    expect(await updateView(ctx, { id, filter: { q: 'nope', priority: { op: 'is', values: ['x'] } } }))
      .toEqual({ ok: false, error: 'That filter is not valid.' });
    expect(await updateView(ctx, { id, filter: { q: 'deploy' }, sort: 'title.desc' })).toEqual({ ok: true, data: null });
    expect(await getView(ctx, id)).toMatchObject({ filter: { q: 'deploy' }, sort: 'title.desc', layout: 'list' });
  });

  it('duplicate copies a readable view as the caller’s private view', async () => {
    const { ctx, bobCtx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'Team', layout: 'board', filter: { q: 'x' }, shared: true });
    const copy = await duplicateView(bobCtx, { id });
    if (!copy.ok) throw new Error(copy.error);
    expect(await getView(bobCtx, copy.data.id)).toMatchObject({
      name: 'Team (copy)', shared: false, mine: true, layout: 'board', filter: { q: 'x' }, projectId,
    });
    const priv = await make(ctx, { projectId, name: 'Private', layout: 'list', filter: {} });
    expect(await duplicateView(bobCtx, { id: priv })).toEqual({ ok: false, error: 'View not found.' });
  });
});

describe('unreadable stored filter', () => {
  it('reads as {} with filterReset, and a save repairs it', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    await db.update(savedView)
      .set({ filter: sql`'{"priority":{"op":"is","values":["nope"]}}'::jsonb` })
      .where(eq(savedView.id, id));
    expect(await getView(ctx, id)).toMatchObject({ filter: {}, filterReset: true });
    await updateView(ctx, { id, filter: {} });
    expect(await getView(ctx, id)).toMatchObject({ filter: {}, filterReset: false });
  });
});

describe('resolveView', () => {
  it('no view: the URL filter with the layout default state', async () => {
    const { ctx, projectId } = await setup();
    expect(await resolveView(ctx, { q: 'x' }, { layout: 'list', projectId })).toEqual({
      filter: { state: 'open', q: 'x' }, sort: null, view: null, modified: false, viewMissing: false,
    });
  });

  it('bare ?view= redirects to the view’s full link', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' });
    expect(await resolveView(ctx, { view: id }, { layout: 'list', projectId }))
      .toEqual({ redirect: `/ws-v/projects/${projectId}/list?view=${id}&state=open&q=x&sort=due.asc` });
  });

  it('opened from its link: not modified; edited: modified; every field cleared: modified, no redirect', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' });
    const at = { layout: 'list' as const, projectId };
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'x', sort: 'due.asc' }, at))
      .toMatchObject({ modified: false, filter: { state: 'open', q: 'x' } });
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'y', sort: 'due.asc' }, at))
      .toMatchObject({ modified: true });
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'x' }, at))
      .toMatchObject({ modified: true }); // sort cleared
    expect(await resolveView(ctx, { view: id, state: 'open' }, at))
      .toMatchObject({ modified: true, filter: { state: 'open' } });
  });

  it('a view opened on the wrong page redirects to its own page', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'board', filter: {} });
    expect(await resolveView(ctx, { view: id, state: 'all' }, { layout: 'list', projectId }))
      .toEqual({ redirect: `/ws-v/projects/${projectId}?view=${id}&state=all` });
  });

  it('missing or unreadable view: URL filter, viewMissing', async () => {
    const { ctx, projectId } = await setup();
    expect(await resolveView(ctx, { view: 'gone', q: 'x' }, { layout: 'list', projectId }))
      .toMatchObject({ view: null, viewMissing: true, filter: { state: 'open', q: 'x' } });
  });
});
```

Run: `yarn vitest run tests/server/views.test.ts` — expected FAIL (modules missing).

- [ ] **Step 5: Queries**

```ts
// src/server/views/queries.ts
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db, project, savedView } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { parseTaskFilter } from '@/lib/task-filter';
import type { ViewLayout, ViewRef } from '@/lib/views';

export type SavedView = ViewRef & {
  name: string;
  shared: boolean;
  ownerId: string;
  mine: boolean;
  /** Owner, or a workspace owner/admin for a shared view. Mirrors service.ts. */
  canEdit: boolean;
  /** The stored filter no longer parsed and reads as {}; saving repairs it. */
  filterReset: boolean;
  createdAt: Date;
};

type Row = typeof savedView.$inferSelect;

export function canEditView(ctx: WorkspaceContext, row: Pick<Row, 'ownerId' | 'shared'>): boolean {
  return row.ownerId === ctx.userId || (row.shared && (ctx.role === 'owner' || ctx.role === 'admin'));
}

export function toSavedView(ctx: WorkspaceContext, row: Row): SavedView {
  const filter = parseTaskFilter(row.filter);
  return {
    id: row.id,
    projectId: row.projectId,
    layout: row.layout as ViewLayout,
    filter: filter ?? {},
    filterReset: filter === null,
    sort: row.sort,
    name: row.name,
    shared: row.shared,
    ownerId: row.ownerId,
    mine: row.ownerId === ctx.userId,
    canEdit: canEditView(ctx, row),
    createdAt: row.createdAt,
  };
}

/** Readable = same workspace, and mine or shared; a view of an archived project is hidden with it. */
function readable(ctx: WorkspaceContext) {
  return and(
    eq(savedView.workspaceId, ctx.workspaceId),
    or(eq(savedView.ownerId, ctx.userId), eq(savedView.shared, true)),
    or(isNull(savedView.projectId), isNull(project.archivedAt)),
  );
}

export async function listViews(
  ctx: WorkspaceContext,
  scope: { projectId: string } | { workspace: true },
): Promise<SavedView[]> {
  const rows = await db
    .select({ view: savedView })
    .from(savedView)
    .leftJoin(project, eq(project.id, savedView.projectId))
    .where(and(
      readable(ctx),
      'projectId' in scope ? eq(savedView.projectId, scope.projectId) : isNull(savedView.projectId),
    ))
    .orderBy(asc(savedView.createdAt), asc(savedView.name), asc(savedView.id));
  return rows.map((r) => toSavedView(ctx, r.view));
}

/** Missing and forbidden look the same: null. */
export async function getView(ctx: WorkspaceContext, id: string): Promise<SavedView | null> {
  const [row] = await db
    .select({ view: savedView })
    .from(savedView)
    .leftJoin(project, eq(project.id, savedView.projectId))
    .where(and(eq(savedView.id, id), readable(ctx)))
    .limit(1);
  return row ? toSavedView(ctx, row.view) : null;
}
```

- [ ] **Step 6: Service**

```ts
// src/server/views/service.ts
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, project, savedView } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { parseTaskFilter, type TaskFilter } from '@/lib/task-filter';
import { formatSortParam, parseSortParam } from '@/lib/task-table-sort';
import { VIEW_LAYOUTS, type ViewLayout } from '@/lib/views';
import { canEditView, getView } from './queries';

const nameSchema = z.string().trim().min(1, 'Give the view a name.').max(60, 'Name is too long.');

/** Only the List sorts; a malformed sort is dropped rather than refused. */
function cleanSort(layout: ViewLayout, sort: string | null | undefined): string | null {
  return layout === 'list' ? formatSortParam(parseSortParam(sort)) : null;
}

function cleanFilter(filter: unknown): TaskFilter | null {
  return parseTaskFilter(filter);
}

export async function createView(
  ctx: WorkspaceContext,
  input: { projectId?: string | null; name: string; shared?: boolean; layout: ViewLayout; filter: unknown; sort?: string | null },
): Promise<Result<{ id: string }>> {
  const parsed = z.object({
    projectId: z.string().min(1).nullable().optional(),
    name: nameSchema,
    shared: z.boolean().optional(),
    layout: z.enum(VIEW_LAYOUTS),
  }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  const { name, layout } = parsed.data;
  const projectId = parsed.data.projectId ?? null;

  const filter = cleanFilter(input.filter);
  if (!filter) return err('That filter is not valid.');
  if (layout === 'board' && !projectId) return err('A board view needs a project.');

  if (projectId) {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt)))
      .limit(1);
    if (!owned) return err('Project not found.');
  }

  const id = newId();
  await db.insert(savedView).values({
    id,
    workspaceId: ctx.workspaceId,
    projectId,
    ownerId: ctx.userId,
    name,
    shared: parsed.data.shared ?? false,
    layout,
    filter,
    sort: cleanSort(layout, input.sort),
  });
  return ok({ id });
}

/** The row if the caller may change it; otherwise the error to return. */
async function editable(ctx: WorkspaceContext, id: string): Promise<Result<{ layout: ViewLayout }>> {
  const view = await getView(ctx, id);
  if (!view) return err('View not found.');
  if (!canEditView(ctx, view)) return err('Only the owner or a workspace admin can change this view.');
  return ok({ layout: view.layout });
}

export async function updateView(
  ctx: WorkspaceContext,
  input: { id: string; name?: string; shared?: boolean; filter?: unknown; sort?: string | null },
): Promise<Result<null>> {
  const parsed = z.object({
    id: z.string().min(1),
    name: nameSchema.optional(),
    shared: z.boolean().optional(),
  }).safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0].message);

  const target = await editable(ctx, parsed.data.id);
  if (!target.ok) return target;

  const patch: Partial<typeof savedView.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.shared !== undefined) patch.shared = parsed.data.shared;
  if (input.filter !== undefined) {
    const filter = cleanFilter(input.filter);
    if (!filter) return err('That filter is not valid.');
    patch.filter = filter;
  }
  if (input.sort !== undefined) patch.sort = cleanSort(target.data.layout, input.sort);

  await db.update(savedView).set(patch)
    .where(and(eq(savedView.id, parsed.data.id), eq(savedView.workspaceId, ctx.workspaceId)));
  return ok(null);
}

export async function duplicateView(
  ctx: WorkspaceContext,
  input: { id: string; name?: string },
): Promise<Result<{ id: string }>> {
  const source = await getView(ctx, input.id);
  if (!source) return err('View not found.');
  return createView(ctx, {
    projectId: source.projectId,
    name: input.name ?? `${source.name} (copy)`.slice(0, 60),
    shared: false,
    layout: source.layout,
    filter: source.filter,
    sort: source.sort,
  });
}

export async function deleteView(ctx: WorkspaceContext, input: { id: string }): Promise<Result<null>> {
  const target = await editable(ctx, input.id);
  if (!target.ok) return target;
  await db.delete(savedView)
    .where(and(eq(savedView.id, input.id), eq(savedView.workspaceId, ctx.workspaceId)));
  return ok(null);
}
```

Note: `canEditView` takes `Pick<Row, 'ownerId' | 'shared'>`; a `SavedView` has both, so passing `view` type-checks.

- [ ] **Step 7: Actions**

```ts
// src/server/views/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createView, deleteView, duplicateView, updateView } from './service';

/**
 * Public HTTP endpoints. The workspace and the owner come from the URL slug and
 * the session (requireWorkspace), never from the caller. Both the rail and the
 * project tabs read views, so every change revalidates the workspace layout.
 */

export async function createViewAction(
  workspaceSlug: string,
  input: Parameters<typeof createView>[1],
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function updateViewAction(
  workspaceSlug: string,
  input: Parameters<typeof updateView>[1],
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function duplicateViewAction(
  workspaceSlug: string,
  input: Parameters<typeof duplicateView>[1],
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await duplicateView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}

export async function deleteViewAction(
  workspaceSlug: string,
  input: Parameters<typeof deleteView>[1],
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteView(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(`/${workspaceSlug}`, 'layout');
    return result;
  });
}
```

- [ ] **Step 8: Resolver**

```ts
// src/server/views/resolve.ts
import type { WorkspaceContext } from '@/lib/session';
import { filterFromParams, sameFilter, withDefaultState, type ParamsLike, type TaskFilter } from '@/lib/task-filter';
import { formatSortParam, parseSortParam } from '@/lib/task-table-sort';
import { defaultState, viewHref, type ViewLayout } from '@/lib/views';
import { getView, type SavedView } from './queries';

export type ResolvedView = {
  filter: TaskFilter;
  sort: string | null;
  view: SavedView | null;
  modified: boolean;
  viewMissing: boolean;
};

function read(params: ParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * What a task page should show. The URL is the whole truth: a view's link
 * carries its filter (lib/views viewHref), so this only compares URL vs stored.
 * A bare `?view=` (no `state`), or a view opened on the wrong page, redirects to
 * the view's own link.
 */
export async function resolveView(
  ctx: WorkspaceContext,
  params: ParamsLike,
  at: { layout: ViewLayout; projectId: string | null },
): Promise<ResolvedView | { redirect: string }> {
  const fallback = defaultState(at.layout);
  const filter = withDefaultState(filterFromParams(params), fallback);
  const sort = at.layout === 'list' ? formatSortParam(parseSortParam(read(params, 'sort'))) : null;

  const viewId = read(params, 'view');
  if (!viewId) return { filter, sort, view: null, modified: false, viewMissing: false };

  const view = await getView(ctx, viewId);
  if (!view) return { filter, sort, view: null, modified: false, viewMissing: true };

  const wrongPage = view.layout !== at.layout || view.projectId !== at.projectId;
  if (wrongPage || read(params, 'state') === undefined) return { redirect: viewHref(ctx.slug, view) };

  const modified = !sameFilter(filter, withDefaultState(view.filter, fallback)) || sort !== view.sort;
  return { filter, sort, view, modified, viewMissing: false };
}
```

- [ ] **Step 9: Run tests**

Run: `yarn vitest run tests/unit/views.test.ts tests/server/views.test.ts tests/server/schema.test.ts`
Expected: PASS. `yarn tsc --noEmit` clean.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/view.ts src/db/schema/index.ts tests/setup/db.ts src/lib/views.ts src/server/views tests/unit/views.test.ts tests/server/views.test.ts
git commit -m "feat(views): saved_view table, views service and URL-vs-stored resolution"
```

---

### Task 4: Filter bar on project Board, List and Calendar

**Files:**
- Create: `src/components/filters/FilterScope.tsx` (transition context + dimming)
- Create: `src/components/filters/filter-chips.ts` (pure chip text + option lists)
- Create: `src/components/filters/FilterBar.tsx`
- Create: `src/components/filters/FilterValuePicker.tsx`
- Create: `src/components/filters/FilterEmpty.tsx`
- Create: `src/components/filters/ViewNotFound.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx`, `list/page.tsx`, `calendar/page.tsx`
- Modify: `src/components/board/Board.tsx` (`hiddenStatusIds` prop + toast)
- Test: `tests/unit/filter-chips.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TaskFilter`, `filterToParams`, `FILTER_PARAM_KEYS`, `isFiltered`, `hiddenStatusIds`, `TaskState`, `DUE_PRESETS`, `PRIORITIES`), Task 2 (`listProjectTasks(ctx, id, filter)`, `listCalendarTasks(ctx, range, filter)`), Task 3 (`resolveView`, `listViews`, `SavedView`, `defaultState`).
- Produces:
  - `FilterScope({ children })` + `useFilterNav(): { pending: boolean; apply(filter: TaskFilter): void }` — `apply` replaces the URL's filter params (drops `page`, keeps `view`, `sort`, `task`, `m`, `layout`) inside a transition.
  - `FilterResults({ children })` — dims while pending.
  - `type FilterOptions = { statuses?: { id: string; name: string; color: string; isDone: boolean; icon: string | null }[]; members: { userId: string; name: string; image: string | null }[]; labels: { id: string; name: string; color: string }[] }`
  - `FILTER_FIELDS`: `type FilterField = 'status' | 'priority' | 'assignee' | 'labels' | 'createdBy' | 'due'`
  - `fieldLabel(field)`, `valueOptions(field, options): { value: string; label: string }[]`, `chipValues(field, filter, options): string`, `toggleOp(field, filter): TaskFilter`, `setValues(field, filter, values: string[]): TaskFilter`, `removeField(field, filter): TaskFilter`, `DUE_LABEL: Record<DuePreset, string>`
  - `FilterBar({ filter, defaultState, options, children? })` — `children` = view controls slot (Task 5).
  - `FilterEmpty({ defaultState })`, `ViewNotFound()`
  - `Board` gains `hiddenStatusIds?: string[]`.

- [ ] **Step 1: Write the failing unit tests for the chip helpers**

```ts
// tests/unit/filter-chips.test.ts
import { describe, expect, it } from 'vitest';
import { chipValues, removeField, setValues, toggleOp, valueOptions } from '@/components/filters/filter-chips';

const options = {
  statuses: [{ id: 's1', name: 'Todo', color: 'muted', isDone: false, icon: null }],
  members: [{ userId: 'u1', name: 'Bob', image: null }],
  labels: [{ id: 'l1', name: 'bug', color: 'red' }],
};

describe('filter chips', () => {
  it('names values, with Me / Unassigned / Unknown', () => {
    expect(chipValues('assignee', { assignee: { op: 'is', ids: ['me', 'none', 'u1', 'gone'] } }, options))
      .toBe('Me, Unassigned, Bob, Unknown');
    expect(chipValues('priority', { priority: { op: 'is', values: ['urgent', 'low'] } }, options)).toBe('Urgent, Low');
    expect(chipValues('due', { due: { preset: 'next_7d' } }, options)).toBe('Next 7 days');
    expect(chipValues('due', { due: { from: '2026-10-01', to: '2026-10-31' } }, options)).toBe('2026-10-01 – 2026-10-31');
    expect(chipValues('due', { due: { to: '2026-10-31' } }, options)).toBe('until 2026-10-31');
    expect(chipValues('labels', { labels: { op: 'none', ids: ['l1'] } }, options)).toBe('bug');
  });

  it('toggles is/not (any/none for labels)', () => {
    expect(toggleOp('priority', { priority: { op: 'is', values: ['low'] } })).toEqual({ priority: { op: 'not', values: ['low'] } });
    expect(toggleOp('labels', { labels: { op: 'any', ids: ['l1'] } })).toEqual({ labels: { op: 'none', ids: ['l1'] } });
  });

  it('setValues keeps the op, and an empty selection removes the field', () => {
    expect(setValues('assignee', { assignee: { op: 'not', ids: ['me'] } }, ['me', 'u1']))
      .toEqual({ assignee: { op: 'not', ids: ['me', 'u1'] } });
    expect(setValues('assignee', { assignee: { op: 'is', ids: ['me'] } }, [])).toEqual({});
    expect(setValues('priority', {}, ['high'])).toEqual({ priority: { op: 'is', values: ['high'] } });
  });

  it('removeField', () => {
    expect(removeField('q', { q: 'x', state: 'open' })).toEqual({ state: 'open' });
    expect(removeField('due', { due: { preset: 'today' }, state: 'all' })).toEqual({ state: 'all' });
  });

  it('assignee options start with Me and Unassigned', () => {
    expect(valueOptions('assignee', options).map((o) => o.label)).toEqual(['Me', 'Unassigned', 'Bob']);
    expect(valueOptions('createdBy', options).map((o) => o.label)).toEqual(['Me', 'Bob']);
  });
});
```

Run: `yarn vitest run tests/unit/filter-chips.test.ts` — expected FAIL (module missing).

- [ ] **Step 2: Implement `filter-chips.ts`**

```ts
// src/components/filters/filter-chips.ts
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
```

`PRIORITY_LABEL` must cover all five priorities (check `src/components/task/Priority.tsx:8`; it is `Record<Priority, string>`). Run the unit test — expected PASS.

- [ ] **Step 3: `FilterScope`**

```tsx
// src/components/filters/FilterScope.tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useContext, useTransition } from 'react';
import { FILTER_PARAM_KEYS, filterToParams, type TaskFilter } from '@/lib/task-filter';
import { cn } from '@/utils/cn';

type FilterNav = { pending: boolean; apply: (filter: TaskFilter) => void };
const Ctx = createContext<FilterNav | null>(null);

/**
 * Owns the transition that filter changes run in, so the bar can show it is
 * working and the results under it can dim while the server re-renders.
 */
export function FilterScope({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(filter: TaskFilter) {
    const next = new URLSearchParams(searchParams);
    for (const key of FILTER_PARAM_KEYS) next.delete(key);
    // A new filter changes every page; back to the first.
    next.delete('page');
    for (const [k, v] of filterToParams(filter)) next.set(k, v);
    // replace: refining a filter is not a step worth walking back through, like sort.
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return <Ctx.Provider value={{ pending, apply }}>{children}</Ctx.Provider>;
}

export function useFilterNav(): FilterNav {
  const nav = useContext(Ctx);
  if (!nav) throw new Error('useFilterNav must be used inside <FilterScope>.');
  return nav;
}

export function FilterResults({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFilterNav();
  return (
    <div aria-busy={pending || undefined} className={cn('transition-opacity duration-150', pending && 'opacity-60', className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: `FilterValuePicker`** — the popover body for one field.

```tsx
// src/components/filters/FilterValuePicker.tsx
'use client';

import { IconCheck } from '@tabler/icons-react';
import { useState } from 'react';
import * as Input from '@/components/ui/input';
import { DUE_PRESETS, type TaskFilter } from '@/lib/task-filter';
import { cn } from '@/utils/cn';
import {
  DUE_LABEL, selectedValues, setValues, valueOptions, type FilterField, type FilterOptions,
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
    const setRange = (patch: { from?: string; to?: string }) => {
      const next = { ...range, ...patch };
      if (!next.from) delete next.from;
      if (!next.to) delete next.to;
      onChange(next.from || next.to ? { ...filter, due: next } : { ...filter, due: undefined });
    };
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

  const all = valueOptions(field, options);
  const chosen = selectedValues(field, filter);
  const shown = all.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(value: string) {
    const next = chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value];
    onChange(setValues(field, filter, next));
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
```

Check `Input.Root` accepts `size="small"` (`src/components/ui/input.tsx`); if its size variants are named differently, use the smallest available.

- [ ] **Step 5: `FilterBar`**

```tsx
// src/components/filters/FilterBar.tsx
'use client';

import { IconFilter, IconLoader2, IconPlus, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { ignoreShortcut } from '@/components/shell/shortcuts';
import * as Button from '@/components/ui/button';
import * as Input from '@/components/ui/input';
import * as Popover from '@/components/ui/popover';
import * as SegmentedControl from '@/components/ui/segmented-control';
import { isFiltered, removeField, type TaskFilter, type TaskState } from '@/lib/task-filter';
import {
  chipValues, FILTER_FIELDS, fieldLabel, isNegated, toggleOp, type FilterField, type FilterOptions,
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
  latest.current = filter;
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
```

Check `Input.Icon` exists in `src/components/ui/input.tsx` and that `Button.Icon` is exported from `button.tsx`; if `Input.Icon` is missing, drop the icon. `apply` from context is a new function each render; it is in the effect's deps — wrap `apply` in `useCallback` inside `FilterScope` (deps `[router, pathname, searchParams]`) so the debounce timer is not reset by unrelated renders.

- [ ] **Step 6: `FilterEmpty` and `ViewNotFound`**

```tsx
// src/components/filters/FilterEmpty.tsx
'use client';

import { IconFilterOff } from '@tabler/icons-react';
import * as Button from '@/components/ui/button';
import type { TaskState } from '@/lib/task-filter';
import { useFilterNav } from './FilterScope';

export function FilterEmpty({ defaultState }: { defaultState: TaskState }) {
  const { apply } = useFilterNav();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <IconFilterOff className="size-6 text-text-soft-400" aria-hidden="true" />
      <p className="text-paragraph-sm text-text-sub-600">No tasks match these filters.</p>
      <Button.Root variant="neutral" mode="stroke" size="xsmall" onClick={() => apply({ state: defaultState })}>
        Clear filters
      </Button.Root>
    </div>
  );
}
```

```tsx
// src/components/filters/ViewNotFound.tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

/** A ?view= the caller can't open: say so once and drop it from the URL. */
export function ViewNotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    toast.error('View not found', { id: 'view-not-found', description: 'It may have been deleted or made private.' });
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  return null;
}
```

- [ ] **Step 7: Board toast for a hidden column**

In `src/components/board/Board.tsx` add prop `hiddenStatusIds = []` (`hiddenStatusIds?: string[]`, doc: "Columns the active filter hides; a card moved into one disappears after saving."). In `onDragEnd`, inside the transition after the `if (!result.ok) {…}` block, before `router.refresh()`:

```ts
      if (result.ok && hiddenStatusIds.includes(after.statusId)) {
        toast(`Moved to ${statusName} — hidden by the current filter.`);
      }
```

- [ ] **Step 8: Wire the three project pages**

Board page (`src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx`): change `searchParams` type to `Promise<Record<string, string | string[] | undefined>>` and:

```tsx
import { redirect } from 'next/navigation';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterEmpty } from '@/components/filters/FilterEmpty';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { hiddenStatusIds, isFiltered } from '@/lib/task-filter';
import { defaultState } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { resolveView } from '@/server/views/resolve';

  // after `if (!project) notFound();`
  const sp = await searchParams;
  const resolved = await resolveView(ctx, sp, { layout: 'board', projectId });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const [tasks, members, labels] = await Promise.all([
    listProjectTasks(ctx, projectId, resolved.filter),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
  ]);
  const openTaskId = typeof sp.task === 'string' ? sp.task : undefined;
  const options = { statuses: project.statuses, members, labels };
  const filtered = isFiltered(resolved.filter, defaultState('board'));
```

Render, between `</ProjectHeader>` and `<Board …>`:

```tsx
      <FilterScope>
        <FilterBar filter={resolved.filter} defaultState={defaultState('board')} options={options} />
        {resolved.viewMissing && <ViewNotFound />}
        {filtered && tasks.length === 0 && <FilterEmpty defaultState={defaultState('board')} />}
        <FilterResults className="flex min-h-0 flex-1 flex-col">
          <Board
            workspaceSlug={workspaceSlug}
            statuses={project.statuses}
            tasks={tasks}
            timezone={ctx.timezone}
            canEditColumns={canManage}
            hiddenStatusIds={hiddenStatusIds(resolved.filter, project.statuses)}
          />
        </FilterResults>
      </FilterScope>
```

(Board columns for statuses the filter hides still render, empty, so drops still work — no change needed: Board renders from `statuses`, not from tasks.)

List page: same pattern with `layout: 'list'`; `FilterResults` wraps `TaskTable`; when `filtered && tasks.length === 0` render `<FilterEmpty defaultState="open" />` instead of `TaskTable`. `TaskTable` keeps reading `?sort=` itself.

Calendar page: same pattern with `layout: 'calendar'`; `m` read from `sp.m`; `listCalendarTasks(ctx, { from, to, projectId }, resolved.filter)`; `FilterResults className="flex min-h-0 flex-1 flex-col"` wraps `CalendarMonth`; no empty state (an empty month is meaningful). `CalendarMonth`'s month links (`monthHref`) must keep the filter params: check `monthHref` in `src/components/calendar/CalendarMonth.tsx:~90`; if it builds from `useSearchParams`, nothing to do; if it builds `?m=` alone, change it to copy the current search params and set `m`.

Next 16 note: `searchParams` is a Promise of `Record<string, string | string[] | undefined>` — confirm in `node_modules/next/dist/docs/` (page.js file convention) before changing the type.

- [ ] **Step 9: Verify**

Run: `yarn vitest run` — expected all PASS. `yarn tsc --noEmit` and `yarn lint` — expected clean.
Manual: `yarn dev` on :3100 (`PORT=3100 BETTER_AUTH_URL=http://localhost:3100 yarn dev`), open a project, add Priority + Assignee filters on Board/List/Calendar, toggle is/not, type text, Clear, press `F`. Check the URL updates and Back works.

- [ ] **Step 10: Commit**

```bash
git add src/components/filters src/components/board/Board.tsx "src/app/(app)/[workspaceSlug]/projects/[projectId]" tests/unit/filter-chips.test.ts
git commit -m "feat(filters): filter bar on project board, list and calendar"
```

---

### Task 5: Saved view tabs and view controls in projects

**Files:**
- Create: `src/components/views/ViewControls.tsx`
- Create: `src/components/views/ViewMenu.tsx`
- Create: `src/components/views/SaveViewDialog.tsx`
- Modify: `src/components/shell/ViewTabs.tsx`
- Modify: `src/components/shell/ProjectHeader.tsx`
- Modify: the three project pages from Task 4 + `summary/page.tsx` (pass views)

**Interfaces:**
- Consumes: Task 3 (`SavedView`, `listViews`, actions, `viewHref`, `MAX_VIEW_TABS`, `ViewLayout`), Task 4 (`FilterBar` children slot).
- Produces:
  - `ViewTabs({ basePath, workspaceSlug, views?: SavedView[] })`
  - `ProjectHeader` gains `workspaceSlug?: string` and `views?: SavedView[]` (default `[]`)
  - `SaveViewDialog({ workspaceSlug, open, onOpenChange, title, initialName?, onSave(name: string, shared: boolean): Promise<string | null> })` — returns an error message or null
  - `ViewMenu({ workspaceSlug, view, placement: 'bar' | 'rail', className? })`
  - `ViewControls({ workspaceSlug, projectId: string | null, layout: ViewLayout, view: SavedView | null, modified: boolean, filter: TaskFilter, sort: string | null })`

- [ ] **Step 1: `SaveViewDialog`**

```tsx
// src/components/views/SaveViewDialog.tsx
'use client';

import { IconBookmark } from '@tabler/icons-react';
import { useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Modal from '@/components/ui/modal';
import * as Switch from '@/components/ui/switch';

/** Name + Private/Shared. Used for Save view, Save as new and Rename (no switch). */
export function SaveViewDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = '',
  showShared = true,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  showShared?: boolean;
  /** Resolves to an error message, or null when saved. */
  onSave: (name: string, shared: boolean) => Promise<string | null>;
}) {
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSave(String(new FormData(event.currentTarget).get('name')), shared);
    setPending(false);
    if (message) setError(message);
    else onOpenChange(false);
  }

  return (
    <Modal.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setError(null); setShared(false); } }}>
      <Modal.Content>
        <Modal.Header icon={IconBookmark} title={title} />
        <form onSubmit={onSubmit}>
          <Modal.Body className="flex flex-col gap-3">
            <TextField id="view-name" label="View name" name="name" required maxLength={60} defaultValue={initialName} autoFocus />
            {showShared && (
              <label className="flex items-center justify-between gap-3 text-label-sm text-text-strong-950">
                <span>
                  Share with the workspace
                  <span className="block text-paragraph-xs text-text-sub-600">
                    Everyone can open it; only you and admins can change it.
                  </span>
                </span>
                <Switch.Root checked={shared} onCheckedChange={setShared} aria-label="Share with the workspace" />
              </label>
            )}
            {error && <FormError>{error}</FormError>}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">Cancel</Button.Root>
            </Modal.Close>
            <Button.Root type="submit" size="small" disabled={pending} className="w-full">
              {pending ? 'Saving…' : submitLabel}
            </Button.Root>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
```

Check `TextField` accepts `defaultValue` (it spreads input props in `src/components/forms/TextField.tsx`; if not, add it there).

- [ ] **Step 2: `ViewMenu`** — Rename / Make shared|private / Duplicate / Delete. Follow `ProjectMenu`'s focus pattern: open the rename dialog from `onCloseAutoFocus`, never directly from the item, or focus lands on `<body>`.

```tsx
// src/components/views/ViewMenu.tsx
'use client';

import { IconCopy, IconDotsVertical, IconLock, IconPencil, IconTrash, IconUsers } from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as Dropdown from '@/components/ui/dropdown';
import { settle } from '@/lib/settle';
import { viewHref } from '@/lib/views';
import { deleteViewAction, duplicateViewAction, updateViewAction } from '@/server/views/actions';
import type { SavedView } from '@/server/views/queries';
import { cn } from '@/utils/cn';
import { SaveViewDialog } from './SaveViewDialog';

export function ViewMenu({
  workspaceSlug,
  view,
  placement,
  className,
}: {
  workspaceSlug: string;
  view: SavedView;
  placement: 'bar' | 'rail';
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const renameNext = useRef(false);
  const [shown, setShown] = useState(false);
  const isOpen = searchParams.get('view') === view.id;

  function run<T>(call: Promise<{ ok: true; data: T } | { ok: false; error: string }>, then: (data: T) => void) {
    startTransition(async () => {
      const result = await settle(call);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      then(result.data);
    });
  }

  function onDuplicate() {
    run(duplicateViewAction(workspaceSlug, { id: view.id }), ({ id }) => {
      toast.success(`Saved “${view.name} (copy)”.`);
      router.push(viewHref(workspaceSlug, { ...view, id }));
    });
  }

  function onShare() {
    run(updateViewAction(workspaceSlug, { id: view.id, shared: !view.shared }), () =>
      toast.success(view.shared ? 'Only you can see this view now.' : 'Shared with the workspace.'));
  }

  async function onDelete() {
    const ok = await confirm({ title: `Delete “${view.name}”?`, description: view.shared ? 'It disappears for everyone.' : 'This cannot be undone.' });
    if (!ok) return;
    run(deleteViewAction(workspaceSlug, { id: view.id }), () => {
      toast.success(`“${view.name}” deleted.`);
      if (isOpen) {
        const next = new URLSearchParams(searchParams);
        next.delete('view');
        router.replace(`${pathname}?${next.toString()}`);
      }
    });
  }

  return (
    <>
      <Dropdown.Root onOpenChange={(open) => open && setShown(true)}>
        <Dropdown.Trigger asChild>
          <CompactButton.Root
            variant="ghost"
            size="medium"
            aria-label={`Actions for view ${view.name}`}
            disabled={pending}
            data-shown={shown || undefined}
            className={cn(placement === 'rail' && 'size-6', className)}
          >
            <CompactButton.Icon as={IconDotsVertical} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content
          align="end"
          onCloseAutoFocus={(e) => {
            setShown(false);
            if (renameNext.current) {
              renameNext.current = false;
              e.preventDefault();
              setRenaming(true);
            }
          }}
        >
          {view.canEdit && (
            <>
              <Dropdown.Item onSelect={() => { renameNext.current = true; }}>
                <Dropdown.ItemIcon as={IconPencil} />Rename
              </Dropdown.Item>
              <Dropdown.Item onSelect={onShare}>
                <Dropdown.ItemIcon as={view.shared ? IconLock : IconUsers} />
                {view.shared ? 'Make private' : 'Share with workspace'}
              </Dropdown.Item>
            </>
          )}
          <Dropdown.Item onSelect={onDuplicate}>
            <Dropdown.ItemIcon as={IconCopy} />Duplicate
          </Dropdown.Item>
          {view.canEdit && (
            <Dropdown.Item onSelect={() => void onDelete()} className="text-error-base">
              <Dropdown.ItemIcon as={IconTrash} />Delete
            </Dropdown.Item>
          )}
        </Dropdown.Content>
      </Dropdown.Root>
      <SaveViewDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename view"
        submitLabel="Rename"
        initialName={view.name}
        showShared={false}
        onSave={async (name) => {
          const result = await settle(updateViewAction(workspaceSlug, { id: view.id, name }));
          return result.ok ? null : result.error;
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: `ViewControls`** — Save view / view name + menu / Modified + Save + Save as new + Reset.

```tsx
// src/components/views/ViewControls.tsx
'use client';

import { IconAlertTriangle, IconBookmark } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Badge from '@/components/ui/badge';
import * as Button from '@/components/ui/button';
import { settle } from '@/lib/settle';
import { isFiltered, type TaskFilter } from '@/lib/task-filter';
import { defaultState, viewHref, type ViewLayout } from '@/lib/views';
import { createViewAction, updateViewAction } from '@/server/views/actions';
import type { SavedView } from '@/server/views/queries';
import { SaveViewDialog } from './SaveViewDialog';
import { ViewMenu } from './ViewMenu';

export function ViewControls({
  workspaceSlug,
  projectId,
  layout,
  view,
  modified,
  filter,
  sort,
}: {
  workspaceSlug: string;
  projectId: string | null;
  layout: ViewLayout;
  view: SavedView | null;
  modified: boolean;
  filter: TaskFilter;
  sort: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();

  async function saveNew(name: string, shared: boolean): Promise<string | null> {
    const result = await settle(createViewAction(workspaceSlug, { projectId, name, shared, layout, filter, sort }));
    if (!result.ok) return result.error;
    toast.success(`Saved view “${name.trim()}”.`);
    router.push(viewHref(workspaceSlug, { id: result.data.id, projectId, layout, filter, sort }));
    return null;
  }

  function saveChanges() {
    if (!view) return;
    startTransition(async () => {
      const result = await settle(updateViewAction(workspaceSlug, { id: view.id, filter, sort }));
      if (!result.ok) toast.error(result.error);
      else toast.success(`Updated “${view.name}”.`);
    });
  }

  const dialog = (
    <SaveViewDialog open={saving} onOpenChange={setSaving} title={view ? 'Save as new view' : 'Save view'} submitLabel="Save view" onSave={saveNew} />
  );

  if (!view) {
    if (!isFiltered(filter, defaultState(layout)) && !sort) return null;
    return (
      <>
        <Button.Root variant="neutral" mode="stroke" size="xxsmall" onClick={() => setSaving(true)}>
          <Button.Icon as={IconBookmark} />Save view
        </Button.Root>
        {dialog}
      </>
    );
  }

  return (
    <>
      {view.filterReset && (
        <span className="inline-flex items-center gap-1 text-paragraph-xs text-warning-base">
          <IconAlertTriangle className="size-4" aria-hidden="true" />
          This view’s filter couldn’t be read and was reset.
        </span>
      )}
      <span className="max-w-40 truncate text-label-sm text-text-strong-950">{view.name}</span>
      {modified && (
        <>
          <Badge.Root variant="lighter" color="orange" size="small">Modified</Badge.Root>
          {view.canEdit && (
            <Button.Root size="xxsmall" disabled={pending} onClick={saveChanges}>Save</Button.Root>
          )}
          <Button.Root variant="neutral" mode="stroke" size="xxsmall" onClick={() => setSaving(true)}>Save as new</Button.Root>
          <Button.Root variant="neutral" mode="ghost" size="xxsmall" asChild>
            <Link href={viewHref(workspaceSlug, view)}>Reset</Link>
          </Button.Root>
        </>
      )}
      <ViewMenu workspaceSlug={workspaceSlug} view={view} placement="bar" />
      {dialog}
    </>
  );
}
```

Check `Badge.Root` colour/size names (`src/components/ui/badge.tsx`) and that `Button.Root` supports `asChild` (Align buttons do via Radix Slot; if not, render a `Link` styled with the button classes). `filterReset` + Save: saving writes the current (valid) filter, which clears `filterReset` on the next render.

- [ ] **Step 4: `ViewTabs` with saved views**

```tsx
// src/components/shell/ViewTabs.tsx
'use client';

import { IconCalendar, IconChartPie, IconChevronDown, IconLayoutKanban, IconList, IconLock } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import * as Dropdown from '@/components/ui/dropdown';
import { MAX_VIEW_TABS, viewHref, type ViewLayout } from '@/lib/views';
import type { SavedView } from '@/server/views/queries';
import { cn } from '@/utils/cn';

const LAYOUT_ICON: Record<ViewLayout, typeof IconList> = { board: IconLayoutKanban, list: IconList, calendar: IconCalendar };

const tab = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm transition-colors duration-150';
const tabActive = 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs';
const tabIdle = 'text-text-sub-600 hover:text-text-strong-950';

export function ViewTabs({
  basePath,
  workspaceSlug,
  views = [],
}: {
  basePath: string;
  workspaceSlug?: string;
  views?: SavedView[];
}) {
  const pathname = usePathname();
  const openView = useSearchParams().get('view');
  const onSummary = pathname.endsWith('/summary');
  const onList = pathname.endsWith('/list');
  const onCalendar = pathname.endsWith('/calendar');
  const builtIn = !openView;

  const fixed = [
    { href: `${basePath}/summary`, label: 'Summary', icon: IconChartPie, active: onSummary },
    { href: basePath, label: 'Board', icon: IconLayoutKanban, active: builtIn && !onSummary && !onList && !onCalendar },
    { href: `${basePath}/list`, label: 'List', icon: IconList, active: builtIn && onList },
    { href: `${basePath}/calendar`, label: 'Calendar', icon: IconCalendar, active: builtIn && onCalendar },
  ];
  const visible = views.slice(0, MAX_VIEW_TABS);
  const overflow = views.slice(MAX_VIEW_TABS);

  return (
    <div role="tablist" aria-label="Project views" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-10 bg-bg-weak-50 p-1">
      {fixed.map(({ href, label, icon: Icon, active }) => (
        <Link key={label} href={href} role="tab" aria-selected={active} className={cn(tab, active ? tabActive : tabIdle)}>
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
      {workspaceSlug && visible.map((view) => {
        const Icon = LAYOUT_ICON[view.layout];
        const active = openView === view.id;
        return (
          <Link
            key={view.id}
            href={viewHref(workspaceSlug, view)}
            role="tab"
            aria-selected={active}
            className={cn(tab, 'max-w-44', active ? tabActive : tabIdle)}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{view.name}</span>
            {!view.shared && <IconLock className="size-3.5 shrink-0 text-text-soft-400" aria-label="Private" />}
          </Link>
        );
      })}
      {workspaceSlug && overflow.length > 0 && (
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button type="button" className={cn(tab, overflow.some((v) => v.id === openView) ? tabActive : tabIdle)}>
              More views
              <IconChevronDown className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end">
            {overflow.map((view) => (
              <Dropdown.Item key={view.id} asChild>
                <Link href={viewHref(workspaceSlug, view)}>
                  <Dropdown.ItemIcon as={LAYOUT_ICON[view.layout]} />
                  {view.name}
                  {!view.shared && <IconLock className="ml-auto size-3.5 text-text-soft-400" aria-label="Private" />}
                </Link>
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Root>
      )}
    </div>
  );
}
```

`ProjectHeader`: add props `workspaceSlug?: string; views?: SavedView[]` and render `<ViewTabs basePath={basePath} workspaceSlug={workspaceSlug} views={views} />`. `useSearchParams` in a client component under a dynamic page needs no Suspense here (TaskTable and Board already use it on the same pages).

- [ ] **Step 5: Wire the pages**

In Board, List, Calendar and Summary pages, add `listViews(ctx, { projectId })` to the `Promise.all` and pass `workspaceSlug={workspaceSlug} views={views}` to `ProjectHeader`. In Board/List/Calendar, pass the view controls into the filter bar:

```tsx
<FilterBar filter={resolved.filter} defaultState={defaultState('list')} options={options}>
  <ViewControls
    workspaceSlug={workspaceSlug}
    projectId={projectId}
    layout="list"
    view={resolved.view}
    modified={resolved.modified}
    filter={resolved.filter}
    sort={resolved.sort}
  />
</FilterBar>
```

(`layout` = `'board'` / `'calendar'` on those pages.) Note for the List: `resolved.sort` is read from `?sort=`, the same param `TaskTable` writes, so a column-header click marks a view Modified.

- [ ] **Step 6: Verify**

Run: `yarn vitest run && yarn tsc --noEmit && yarn lint` — expected clean.
Manual on :3100: filter the List → Save view (shared) → the tab appears with the List icon and the URL becomes `…/list?view=…&state=open…`; change a filter → Modified + Save / Save as new / Reset; Reset restores; reload a bare `…/list?view=<id>` → redirected to the full link; Rename and Make private from the ⋯ menu (focus lands in the name field); add 6 views → sixth is under "More views"; `?view=nope` → "View not found" toast and `view` removed.

- [ ] **Step 7: Commit**

```bash
git add src/components/views src/components/shell/ViewTabs.tsx src/components/shell/ProjectHeader.tsx "src/app/(app)/[workspaceSlug]/projects/[projectId]"
git commit -m "feat(views): save, open, modify and manage views as project tabs"
```

---

### Task 6: All tasks page and the rail's Views section

**Files:**
- Create: `src/app/(app)/[workspaceSlug]/tasks/page.tsx`
- Create: `src/components/views/WorkspaceTaskTable.tsx`
- Modify: `src/components/shell/Rail.tsx` (All tasks item; Views section)
- Modify: `src/components/shell/WorkspaceShell.tsx` (fetch workspace views)

**Interfaces:**
- Consumes: Task 2 (`listWorkspaceTasks`, `WorkspaceTaskRow`, `WORKSPACE_TASK_LIMIT`, `listCalendarTasks` with `{ workspace: true }`), Task 3 (`resolveView`, `listViews`, `SavedView`, `viewHref`), Task 4 (`FilterScope`, `FilterResults`, `FilterBar`, `FilterEmpty`, `ViewNotFound`), Task 5 (`ViewControls`, `ViewMenu`).
- Produces: `RailProps` gains `views: SavedView[]`; `WorkspaceTaskTable({ workspaceSlug, tasks, timezone })`.

- [ ] **Step 1: `WorkspaceTaskTable`** — read-only, server-sorted via `?sort=`.

```tsx
// src/components/views/WorkspaceTaskTable.tsx
'use client';

import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { projectDot } from '@/components/brand/tint';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DueChip } from '@/components/task/DueChip';
import { PriorityChip } from '@/components/task/Priority';
import { StatusIcon } from '@/components/task/StatusIcon';
import { formatSortParam, parseSortParam, type SortableColumn } from '@/lib/task-table-sort';
import type { WorkspaceTaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const COLUMNS: { id: SortableColumn | null; label: string; className?: string }[] = [
  { id: 'title', label: 'Title' },
  { id: null, label: 'Project', className: 'max-md:hidden' },
  { id: 'status', label: 'Status', className: 'max-sm:hidden' },
  { id: 'priority', label: 'Priority', className: 'max-sm:hidden' },
  { id: 'assignee', label: 'Assignee', className: 'max-md:hidden' },
  { id: 'due', label: 'Due' },
];

/** Tasks across projects. Read-only; sorting is a link, done by the server. */
export function WorkspaceTaskTable({
  workspaceSlug,
  tasks,
  timezone,
}: {
  workspaceSlug: string;
  tasks: WorkspaceTaskRow[];
  timezone: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [current] = parseSortParam(searchParams.get('sort'));

  function sortHref(id: SortableColumn): string {
    const next = new URLSearchParams(searchParams);
    // asc → desc → off, the List's cycle.
    const param = current?.id !== id ? formatSortParam([{ id, desc: false }])
      : !current.desc ? formatSortParam([{ id, desc: true }]) : null;
    if (param) next.set('sort', param);
    else next.delete('sort');
    return `${pathname}?${next.toString()}`;
  }

  return (
    <table className="w-full text-left">
      <thead className="border-b border-stroke-soft-200 text-label-xs text-text-sub-600">
        <tr>
          {COLUMNS.map((c) => {
            const sorted = c.id && current?.id === c.id ? (current.desc ? 'descending' : 'ascending') : undefined;
            return (
              <th key={c.label} scope="col" aria-sort={sorted} className={cn('px-4 py-2 font-medium lg:px-6', c.className)}>
                {c.id ? (
                  <Link href={sortHref(c.id)} replace scroll={false} className="inline-flex items-center gap-1 hover:text-text-strong-950">
                    {c.label}
                    {sorted === 'ascending' && <IconArrowUp className="size-3.5" aria-hidden="true" />}
                    {sorted === 'descending' && <IconArrowDown className="size-3.5" aria-hidden="true" />}
                  </Link>
                ) : c.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id} className="border-b border-stroke-soft-200 text-paragraph-sm hover:bg-bg-weak-50">
            <td className="max-w-0 px-4 py-2 lg:px-6">
              <Link href={`/${workspaceSlug}/tasks/${t.id}`} className={cn('block truncate text-label-sm', t.isDone ? 'text-text-soft-400 line-through' : 'text-text-strong-950')}>
                {t.title}
              </Link>
            </td>
            <td className="px-4 py-2 max-md:hidden lg:px-6">
              <span className="inline-flex items-center gap-2 text-text-sub-600">
                <span className={cn('size-2 rounded-full', projectDot({ id: t.projectId, color: t.projectColor }))} aria-hidden="true" />
                {t.projectName}
              </span>
            </td>
            <td className="px-4 py-2 max-sm:hidden lg:px-6">
              <span className="inline-flex items-center gap-1.5 text-text-sub-600">
                <StatusIcon status={{ color: t.statusColor, isDone: t.isDone, icon: t.statusIcon }} />
                {t.statusName}
              </span>
            </td>
            <td className="px-4 py-2 max-sm:hidden lg:px-6"><PriorityChip priority={t.priority} /></td>
            <td className="px-4 py-2 max-md:hidden lg:px-6">
              {t.assigneeName ? (
                <span className="inline-flex items-center gap-2 text-text-sub-600">
                  <AssigneeAvatar name={t.assigneeName} image={t.assigneeImage} />
                  {t.assigneeName}
                </span>
              ) : <span className="text-text-soft-400">—</span>}
            </td>
            <td className="px-4 py-2 lg:px-6"><DueChip dueDate={t.dueDate} timezone={timezone} done={t.isDone} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: All tasks page**

```tsx
// src/app/(app)/[workspaceSlug]/tasks/page.tsx
import { IconCalendar, IconList } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { FilterBar } from '@/components/filters/FilterBar';
import { FilterEmpty } from '@/components/filters/FilterEmpty';
import { FilterResults, FilterScope } from '@/components/filters/FilterScope';
import { ViewNotFound } from '@/components/filters/ViewNotFound';
import { ViewControls } from '@/components/views/ViewControls';
import { WorkspaceTaskTable } from '@/components/views/WorkspaceTaskTable';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { filterToParams, isFiltered } from '@/lib/task-filter';
import { parseSortParam } from '@/lib/task-table-sort';
import { defaultState, type ViewLayout } from '@/lib/views';
import { listLabels, listWorkspaceMembers } from '@/server/labels/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { listWorkspaceTasks, WORKSPACE_TASK_LIMIT } from '@/server/tasks/queries';
import { resolveView } from '@/server/views/resolve';
import { cn } from '@/utils/cn';

/** Every task in the workspace's active projects, filtered; the home of workspace views. */
export default async function AllTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const sp = await searchParams;
  const layout: ViewLayout = sp.layout === 'calendar' ? 'calendar' : 'list';

  const resolved = await resolveView(ctx, sp, { layout, projectId: null });
  if ('redirect' in resolved) redirect(resolved.redirect);
  const [members, labels] = await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx)]);
  const options = { members, labels };
  const filtered = isFiltered(resolved.filter, defaultState(layout));

  // Switching layout keeps the filter but leaves any view.
  const layoutHref = (to: ViewLayout) => {
    const p = filterToParams(resolved.filter);
    if (to === 'calendar') p.set('layout', 'calendar');
    const q = p.toString();
    return `/${workspaceSlug}/tasks${q ? `?${q}` : ''}`;
  };

  let body: React.ReactNode;
  if (layout === 'calendar') {
    const today = todayInZone(ctx.timezone);
    const month = parseMonth(typeof sp.m === 'string' ? sp.m : undefined, today);
    const weekStart = await getWeekStart(ctx);
    const days = monthWeeks(month, weekStart).flat();
    const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], workspace: true }, resolved.filter);
    body = (
      <CalendarMonth workspaceSlug={workspaceSlug} month={month} weekStart={weekStart} today={today} tasks={tasks} taskHref="page" showProject />
    );
  } else {
    const { tasks, truncated } = await listWorkspaceTasks(ctx, resolved.filter, { sort: parseSortParam(resolved.sort)[0] ?? null });
    body = tasks.length === 0 && filtered ? <FilterEmpty defaultState="open" /> : (
      <>
        {truncated && (
          <p className="px-4 py-2 text-paragraph-xs text-text-sub-600 lg:px-6">
            Showing the first {WORKSPACE_TASK_LIMIT} — narrow the filters to see the rest.
          </p>
        )}
        <WorkspaceTaskTable workspaceSlug={workspaceSlug} tasks={tasks} timezone={ctx.timezone} />
      </>
    );
  }

  return (
    <main className={cn(layout === 'calendar' && 'flex h-[calc(100dvh-3.5rem)] flex-col')}>
      <header className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 lg:px-6">
        <h1 className="min-w-0 flex-1 truncate text-label-lg text-text-strong-950">{resolved.view?.name ?? 'All tasks'}</h1>
        <div role="tablist" aria-label="Layout" className="flex items-center gap-1 rounded-10 bg-bg-weak-50 p-1">
          {(['list', 'calendar'] as const).map((l) => {
            const Icon = l === 'list' ? IconList : IconCalendar;
            const active = layout === l && !resolved.view;
            return (
              <Link key={l} href={layoutHref(l)} role="tab" aria-selected={active}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm',
                  active ? 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs' : 'text-text-sub-600 hover:text-text-strong-950')}>
                <Icon className="size-4" aria-hidden="true" />
                {l === 'list' ? 'List' : 'Calendar'}
              </Link>
            );
          })}
        </div>
      </header>
      <FilterScope>
        <FilterBar filter={resolved.filter} defaultState={defaultState(layout)} options={options}>
          <ViewControls
            workspaceSlug={workspaceSlug}
            projectId={null}
            layout={layout}
            view={resolved.view}
            modified={resolved.modified}
            filter={resolved.filter}
            sort={resolved.sort}
          />
        </FilterBar>
        {resolved.viewMissing && <ViewNotFound />}
        <FilterResults className={cn(layout === 'calendar' && 'flex min-h-0 flex-1 flex-col')}>{body}</FilterResults>
      </FilterScope>
    </main>
  );
}
```

Check: the existing `/[workspaceSlug]/tasks/[taskId]` route stays a sibling; `tasks/page.tsx` adds the index only. Check `PageBreadcrumb`/`crumbs.ts` (`src/components/shell/crumbs.ts`): if it maps known workspace paths to labels, add `tasks` → "All tasks".

- [ ] **Step 3: Rail**

In `WorkspaceShell.tsx` add `listViews(ctx, { workspace: true })` to the `Promise.all` and put `views` in `railProps`. In `Rail.tsx`:
- `Props` gains `views: SavedView[]` (import type from `@/server/views/queries`).
- Add to the fixed items, after "For you": `{ href: \`/${workspaceSlug}/tasks\`, label: 'All tasks', icon: IconListDetails, activeIcon: IconListDetails }`. Active check for this item must ignore a view: `pathname === href && !searchParams.get('view')` (add `useSearchParams`).
- After the Starred section, render a Views section when `views.length > 0`:

```tsx
        {views.length > 0 && (
          <div className="space-y-1">
            <div className="px-2.5 py-1"><SectionLabel>Views</SectionLabel></div>
            {views.map((view) => {
              const active = openView === view.id;
              const Icon = view.layout === 'calendar' ? IconCalendar : IconListDetails;
              return (
                <div key={view.id} className={cn(navItem, 'group relative h-9', active ? navActive : navIdle)}>
                  <Link
                    href={viewHref(workspaceSlug, view)}
                    aria-current={active ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 self-stretch after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-base"
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-primary-base' : 'text-text-soft-400')} aria-hidden="true" />
                    <span className="truncate">{view.name}</span>
                    {!view.shared && <IconLock className="size-3.5 shrink-0 text-text-soft-400" aria-label="Private" />}
                  </Link>
                  <ViewMenu
                    workspaceSlug={workspaceSlug}
                    view={view}
                    placement="rail"
                    className="relative z-10 -mr-1 hidden shrink-0 group-focus-within:flex group-hover:flex data-shown:flex pointer-coarse:flex"
                  />
                </div>
              );
            })}
          </div>
        )}
```

with `const openView = useSearchParams().get('view');` in `RailBody`, and imports `IconListDetails`, `IconLock` from Tabler, `viewHref` from `@/lib/views`, `ViewMenu` from `@/components/views/ViewMenu`. `AppHeader` forwards `railProps` to `MobileNav` unchanged; its type is `RailProps`, so `views` flows through.

Note: `useSearchParams` in the rail renders inside the workspace layout; if `next build` reports a missing Suspense boundary for it, wrap `<Rail>` and `MobileNav` usages in `<Suspense>` in `WorkspaceShell`/`AppHeader` (check `node_modules/next/dist/docs/` for `useSearchParams` and static rendering).

- [ ] **Step 4: Verify**

Run: `yarn vitest run && yarn tsc --noEmit && yarn lint && yarn build` — expected clean (build catches Suspense issues).
Manual on :3100: All tasks lists tasks from two projects with Project column; sort headers cycle asc → desc → off; Calendar switch keeps the filter; save a workspace view → it appears under Views in the rail and the mobile drawer; ⋯ menu works there; a teammate sees a shared one but its menu shows only Duplicate.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/[workspaceSlug]/tasks/page.tsx" src/components/views/WorkspaceTaskTable.tsx src/components/shell
git commit -m "feat(views): All tasks page and workspace views in the rail"
```

---

### Task 7: End-to-end tests

**Files:**
- Create: `tests/e2e/views.spec.ts`

**Interfaces:**
- Consumes: everything above through the UI; `createTask` from `tests/e2e/tasks.ts`; the invite flow pattern from `tests/e2e/invite.spec.ts` (`invitationIdFor` reads `DATABASE_URL_TEST`).

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/views.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createTask } from './tasks';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
}

async function invitationIdFor(email: string): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM invitation WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email],
    );
    return rows[0].id;
  } finally {
    await client.end();
  }
}

/** Owner with a workspace and a project "Launch" holding two tasks; returns the project URL and slug. */
async function ownerWithProject(page: Page) {
  const s = stamp();
  await page.goto('/auth/sign-up');
  await signUp(page, 'Owner', `views-owner-${s}@example.com`);
  await page.getByLabel('Workspace name').fill(`Views ${s}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();
  await createTask(page, 'Alpha release');
  await createTask(page, 'Beta docs');
  const url = new URL(page.url());
  return { projectUrl: url.pathname, slug: url.pathname.split('/')[1] };
}

async function filterByText(page: Page, text: string) {
  await page.getByLabel('Filter by text').fill(text);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${text}`));
}

test('filter the list, save a shared view; a teammate opens it, cannot edit, can duplicate', async ({ page, browser }) => {
  const { projectUrl, slug } = await ownerWithProject(page);
  await page.goto(`${projectUrl}/list`);
  await expect(page.getByRole('link', { name: 'Beta docs' })).toBeVisible();

  await filterByText(page, 'alpha');
  await expect(page.getByRole('link', { name: 'Alpha release' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta docs' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save view' });
  await dialog.getByLabel('View name').fill('Alpha only');
  await dialog.getByRole('switch', { name: 'Share with the workspace' }).click();
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(page).toHaveURL(/[?&]view=/);
  const tab = page.getByRole('tab', { name: 'Alpha only' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  // Modify, then Reset.
  await page.getByLabel('Filter by text').fill('');
  await expect(page.getByText('Modified')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta docs' })).toBeVisible();
  await page.getByRole('link', { name: 'Reset' }).click();
  await expect(page.getByText('Modified')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Beta docs' })).toHaveCount(0);

  // A bare ?view= link loads the stored filter.
  const viewId = new URL(page.url()).searchParams.get('view')!;
  await page.goto(`${projectUrl}/list?view=${viewId}`);
  await expect(page).toHaveURL(/[?&]q=alpha/);

  // Invite a member.
  const guestEmail = `views-guest-${stamp()}@example.com`;
  await page.goto(`/${slug}/settings/members`);
  await page.getByLabel('Invite by email').fill(guestEmail);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invitation sent to ${guestEmail}.`)).toBeVisible();
  const invitationId = await invitationIdFor(guestEmail);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/invite/${invitationId}`);
  await signUp(guest, 'Guest', guestEmail);
  await guest.getByRole('button', { name: 'Accept' }).click();
  await expect(guest).toHaveURL(new RegExp(`/${slug}$`));

  await guest.goto(`${projectUrl}/list`);
  await guest.getByRole('tab', { name: 'Alpha only' }).click();
  await expect(guest.getByRole('link', { name: 'Beta docs' })).toHaveCount(0);
  await guest.getByRole('button', { name: 'Actions for view Alpha only' }).click();
  await expect(guest.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(guest.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await guest.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(guest.getByRole('tab', { name: /Alpha only \(copy\)/ })).toHaveAttribute('aria-selected', 'true');

  // The copy is private: the owner doesn't see it.
  await page.reload();
  await expect(page.getByRole('tab', { name: /Alpha only \(copy\)/ })).toHaveCount(0);
});

test('a workspace view saved from All tasks shows up in the rail', async ({ page }) => {
  const { slug } = await ownerWithProject(page);
  await page.getByRole('link', { name: 'All tasks' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/tasks`));
  await expect(page.getByRole('link', { name: 'Beta docs' })).toBeVisible();

  await filterByText(page, 'beta');
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save view' });
  await dialog.getByLabel('View name').fill('Docs work');
  await dialog.getByRole('button', { name: 'Save view' }).click();

  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByRole('link', { name: /Docs work/ })).toBeVisible();
  await page.goto(`/${slug}`);
  await nav.getByRole('link', { name: /Docs work/ }).click();
  await expect(page.getByRole('heading', { name: 'Docs work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alpha release' })).toHaveCount(0);
});

test('board status filter keeps empty columns; an unknown view says so', async ({ page }) => {
  const { projectUrl } = await ownerWithProject(page);
  await page.goto(projectUrl);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/[?&]status=/);
  await expect(page.getByText('Alpha release')).toHaveCount(0);
  // Columns are still there to drop into.
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();

  await page.goto(`${projectUrl}/list?view=does-not-exist`);
  await expect(page.getByText('View not found')).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]view=/);
});
```

Before running, check selectors against the real DOM: how Board column headers are exposed (`getByRole('heading', { name: 'Todo' })` — adjust to what `Board.tsx` renders), the task title links in the List (`TaskTable` rows), and the rail link names. Adjust selectors, not behaviour.

- [ ] **Step 2: Run e2e on the alternate port**

Create a temp config (not committed) `playwright.3100.config.ts` that imports the default config and overrides `use.baseURL` to `http://localhost:3100` and `webServer` to run on port 3100 with `BETTER_AUTH_URL=http://localhost:3100`. Run:
`yarn db:setup:test && yarn playwright test -c playwright.3100.config.ts tests/e2e/views.spec.ts`
Expected: 3 passed. Then the whole suite: `yarn playwright test -c playwright.3100.config.ts` — expected all green (filters change Board/List/Calendar pages; existing board, list-bulk, calendar specs must still pass). Delete the temp config afterwards.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/views.spec.ts
git commit -m "test(e2e): filters, project and workspace saved views"
```

---

## Deploy note (for the PR body)

New table `saved_view`. Run `yarn db:setup:prod` (and `yarn db:setup:dev`) **before** deploying: every workspace page reads `saved_view` for the rail, and every project page for its tabs, so a missing table breaks them all.
