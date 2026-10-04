# Task filters + saved views — design

Roadmap item 10 (slice 6), `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`.
The roadmap assumed slice 3 left filter predicates behind; it did not (slice 3 shipped only
the ⌘K search). So this item builds the filter layer first and saved views on top of it.

## Goal

Narrow any task list down to what matters, and come back to that cut in one click.

Success:

- Board, List and Calendar in a project can be filtered by status, priority, assignee,
  labels, due date, creator, open/done state and text; the filter lives in the URL, so a
  link or the back button reproduces it.
- A new **All tasks** page lists tasks across every active project with the same filters.
- The current filter + layout + sort can be saved as a named view, private or shared.
- Project views show up as extra tabs in that project; workspace views show up in the rail.
- A shared view can be opened by every member but changed only by its owner or a
  workspace owner/admin; anyone can duplicate it.

## Decisions

- **Scope:** filter bar and saved views ship together in one branch/PR.
- **View scope:** project views (`project_id` set) and workspace views (`project_id` null).
- **Sharing:** per view, private or shared. Shared = visible to every member.
- **View state:** filter + layout (`board` / `list` / `calendar`) + List sort. Column
  layout (order, hidden, density, page size) stays per-browser in localStorage.
- **Workspace views:** List or Calendar only. Board needs one project's statuses.
- **Filter model:** a fixed set of fields. Values within a field are OR'ed; fields are
  AND'ed. Each field has `is` / `is not`. No nested groups.
- **Where filtering runs:** server-side only (approach A). URL params → Zod `TaskFilter` →
  `compileTaskFilter(ctx, filter)` → Drizzle `SQL` predicates. Saved views store the same
  `TaskFilter` JSON.

Rejected:

- Client-side filtering for project pages + server compiler for workspace pages: two
  implementations of the same semantics ("me", relative dates in the user's zone, labels)
  that would drift.
- A shared TS predicate run in both places: still two evaluators, plus parity tests.
- Nested AND/OR rule groups: much bigger UI, compiler and test surface for little need.
- Drag-reordering views (and a `position` column): order by `created_at` until asked.
- Storing List column layout in the view: shared views would fight each browser's
  localStorage settings.

## Data

### `saved_view` (new, `src/db/schema/view.ts`)

| column | type | notes |
| --- | --- | --- |
| `id` | `text` pk | |
| `workspace_id` | `text` → `organization.id`, cascade | |
| `project_id` | `text` null → `project.id`, cascade | null = workspace view |
| `owner_id` | `text` → `user.id`, cascade | |
| `name` | `text` not null | 1–60 chars, trimmed |
| `shared` | `boolean` not null default `false` | |
| `layout` | `text` not null | `'board' \| 'list' \| 'calendar'` |
| `filter` | `jsonb` not null default `'{}'` | `TaskFilter`, Zod-parsed on read and write |
| `sort` | `text` null | `task-table-sort` format, e.g. `due.asc`; List only |
| `created_at`, `updated_at` | `timestamptz` | |

- Check: `layout <> 'board' OR project_id IS NOT NULL`.
- Check: `layout IN ('board','list','calendar')`.
- Index: `(workspace_id, project_id)`.
- Order everywhere: `created_at`, then `name`.
- Exported from `src/db/schema/index.ts`; added to the `TRUNCATE` list in `tests/setup/db.ts`.

### `TaskFilter` (`src/lib/task-filter.ts`, client-safe, no `src/db` imports)

```ts
type Op = 'is' | 'not';

type TaskFilter = {
  state?: 'open' | 'done' | 'all';                    // by the task status's isDone
  status?: { op: Op; ids: string[] };                  // project scope only
  priority?: { op: Op; values: Priority[] };
  assignee?: { op: Op; ids: ('me' | 'none' | string)[] };
  labels?: { op: 'any' | 'none'; ids: string[] };
  createdBy?: { op: Op; ids: ('me' | string)[] };
  due?:
    | { preset: 'overdue' | 'today' | 'this_week' | 'next_7d' | 'none' }
    | { from?: string; to?: string };                  // YYYY-MM-DD, inclusive
  q?: string;                                          // trimmed, ≤ 200 chars
};
```

- Unknown keys stripped; empty arrays and empty `q` drop their field.
- `state` default depends on the page: Board → `all` (it shows a done column today);
  List, Calendar and All tasks → `open`. The default is applied by the page, not stored,
  so a view saved with no `state` follows its layout's default.
- `filterFromParams(searchParams)` / `filterToParams(filter)` convert to and from readable
  URL params, one per field: `?priority=high,urgent&assignee=!me,none&labels=!l1&due=overdue`
  (`!` prefix = `not` / `none`), `?due=2026-10-01..2026-10-31`, `?q=…`, `?state=done`.
  An invalid value drops that field only; the rest of the filter is kept. These helpers
  never throw.

## Compiler (`src/server/tasks/filter.ts`)

`compileTaskFilter(ctx: WorkspaceContext, filter: TaskFilter, scope: 'project' | 'workspace'): SQL[]`

The result is AND'ed with each query's fixed predicates (workspace, not archived,
top-level, and for workspace scope: project not archived). Only Drizzle builders and
parameterised `sql` templates — no string interpolation.

- `state` → join/`EXISTS` on `task_status.is_done`.
- `status` → `inArray` / `notInArray` on `status_id`; ignored in workspace scope.
- `priority` → `inArray` / `notInArray`.
- `assignee` → `'me'` becomes `ctx.userId`, `'none'` becomes `assignee_id IS NULL`, the
  rest `inArray`; OR'ed together, negated as a whole for `not` (with `IS NULL` handled so
  `not me` still returns unassigned tasks).
- `createdBy` → same as assignee without `none`.
- `labels` → `EXISTS (select 1 from task_label where task_id = task.id and label_id in …)`
  for `any`, `NOT EXISTS` for `none`.
- `due` presets, all against `todayInZone(ctx.timezone)`:
  `overdue` = `due_date < today` (done tasks are excluded by `state`, not by the preset);
  `today` = `= today`; `this_week` = between the week start from `getWeekStart(ctx)` and
  six days after; `next_7d` = `today ..= today + 6`; `none` = `IS NULL`. A range compares
  `due_date` with inclusive bounds.
- `q` → the ⌘K matching: `toPrefixQuery` against `task.search`, or title `ILIKE`.

Stale ids (deleted label, user, status) just match nothing. Ids from another workspace are
harmless: every predicate is AND'ed with `task.workspace_id = ctx.workspaceId`.

## Queries

In `src/server/tasks/`:

- `listProjectTasks(ctx, projectId, filter = {})` — Board and List pass the filter.
- `listCalendarTasks(ctx, range & scope, filter = {})` — project and `mine` scopes.
- New `listWorkspaceTasks(ctx, filter, { limit = 500 })` → `{ tasks, truncated }`. All
  active projects, with project name and colour for a Project column. Default order
  `due_date asc nulls last`, then `created_at`. `truncated` when more than `limit` rows.

No new indexes until a slow query is measured; `task_assignee_idx` already serves the
assignee filter and `task_label`'s primary key serves the `EXISTS`.

## Saved views (`src/server/views/`)

- `queries.ts`
  - `listViews(ctx, { projectId } | { workspace: true })` → the caller's own views plus
    shared ones, in that scope.
  - `getView(ctx, id)` → the view if same workspace and (owner or shared), else
    `NotFound`. Missing and forbidden look the same.
  - Every read parses `filter` with Zod; a failure returns `filter: {}` and
    `filterReset: true` instead of throwing.
- `service.ts`
  - `createView(ctx, { projectId?, name, shared, layout, filter, sort })`
  - `updateView(ctx, id, patch)` — any of name, shared, layout, filter, sort.
  - `duplicateView(ctx, id, { name? })` — copy owned by `ctx.userId`, private, default
    name `"<name> (copy)"`. Works on any view the caller can read.
  - `deleteView(ctx, id)`
  - Write rule: owner always; workspace `owner`/`admin` may update or delete **shared**
    views. Private views are invisible and untouchable to everyone else, admins included
    (same rule as the personal to-do list).
  - Validation: `filter` re-parsed with Zod; `board` without a project rejected; the
    project must belong to `ctx.workspaceId` and not be archived.
- `actions.ts` — `withAction` wrappers taking `workspaceSlug`; `requireWorkspace`;
  `revalidatePath(`/${slug}`, 'layout')` (both rail and tabs read views).

## Routes

- **Project pages** (Board = project root, `list`, `calendar`) read the filter from
  `searchParams`. A saved project view is the link `<layout route>?view=<id>`. The page
  loads the view, then applies any explicit filter params on top; if the result differs
  from the stored filter (or the sort differs), the view is "modified".
- **All tasks** — new page `/[workspaceSlug]/tasks`, List or Calendar (`?layout=calendar`).
  A saved workspace view is `/[workspaceSlug]/tasks?view=<id>`.
- A `?view=` that `getView` can't return → the page renders unfiltered with a
  "View not found" toast. No 404 page: a link to a since-deleted view must not dead-end.

## UI

Built from the vendored Align UI atoms (`popover`, `command-menu`, `tag`, `dropdown`,
`datepicker`, `segmented-control`, `modal`, `confirm-dialog`) and Tabler icons.

### Filter bar (`src/components/filters/`)

A row under the project tabs and under the All tasks header.

- **+ Filter** → popover listing the fields (Status only in a project) → second step is a
  searchable multi-select, or due presets plus a date range.
- Each active field is a chip: `Assignee  is  Me, Unassigned  ✕`. Clicking the operator
  toggles is / is not; clicking the values reopens the picker; ✕ removes the field.
- **State** segmented control: Open / Done / All.
- Text input "Filter by text…", debounced 300 ms.
- **Clear** when anything is set.
- Every change is a `router.replace` with the new params inside `useTransition`; while
  pending the bar shows a spinner and the results dim.
- Shortcut `F` opens **+ Filter**, through `ignoreShortcut` like the others.

### View controls (right end of the filter bar)

- No view, some filter → **Save view** → modal: name, Private / Shared switch. Layout and
  sort come from the current page.
- View open, unmodified → the view's name with a ⋯ menu: Rename, Make shared / private,
  Duplicate, Delete (confirm). A member who can't edit sees only Duplicate.
- View open, modified → "Modified" badge + **Save** (if allowed), **Save as new**, **Reset**.
- A view whose stored filter failed to parse shows "This view's filter couldn't be read
  and was reset"; saving fixes it.

### Placement

- **Project tabs:** saved project views follow Calendar in `ViewTabs`, each with its
  layout icon and a lock icon when private. More than 5 → the rest go into a
  "More views" dropdown.
- **Rail:** new fixed item **All tasks**; new section **Views** (below Starred) listing
  workspace views, with the same hover ⋯ menu as project rows. Fetched in
  `WorkspaceShell` and passed through `railProps`.
- **All tasks page:** `TaskTable` with an extra Project column, or the month grid; a
  segmented control switches between them. A "Showing the first 500 — narrow the
  filters" note when `truncated`.

### Board specifics

- Status columns excluded by the filter still render, empty, so cards can still be
  dropped there.
- A card moved into a column the filter hides disappears after the save, with a toast
  "Moved — hidden by the current filter".

### Empty state

"No tasks match these filters" with a **Clear filters** button.

## Errors

- Bad filter JSON in the database → `{}` + `filterReset` notice (above). Never a 500.
- Bad URL params → that field dropped, rest kept.
- Unreadable `?view=` → unfiltered page + toast.
- Project deleted → its views cascade. Project archived → its views are hidden with it.
- Service errors (permission, validation) go through `Result<T>` to a toast, as elsewhere.

## Security

- Every view read and write is scoped `workspace_id = ctx.workspaceId`; `owner_id` and
  the workspace come from `ctx`, never from the client.
- Permission matrix: owner / member / admin × private / shared, enforced in `service.ts`
  and `getView`, covered by tests.
- Filters compile only through Drizzle builders and parameterised `sql`.

## Testing (TDD)

- **Unit:** `TaskFilter` parsing (strip, drop empties, reject bad values per field);
  params ↔ filter round trip including `!`, `me`, `none`, presets, ranges and garbage.
- **Server (real Postgres):** `compileTaskFilter` per field with is / not; labels any /
  none; `me` and unassigned; each due preset with `ctx.timezone` east and west of UTC
  near midnight; `this_week` with Sunday and Monday week starts; `q`; workspace isolation;
  `listWorkspaceTasks` truncation and archived-project exclusion; views service permission
  matrix; board-needs-project; unreadable stored filter.
- **Components:** filter bar adds, removes and toggles chips; modified-state detection.
- **e2e:** filter List by priority + assignee → save shared → a second member sees the
  tab, can't edit, can duplicate; workspace view from All tasks appears in the rail;
  Board status filter; bad `?view=` shows the toast.

## Deploy

New table. The PR must say: run `yarn db:setup:prod` (and `db:setup:dev`) **before**
deploying — pages read `saved_view` for tabs and the rail, so a missing table breaks
every workspace page.
