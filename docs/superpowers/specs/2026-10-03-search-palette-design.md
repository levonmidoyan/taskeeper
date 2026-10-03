# Full-text search + ⌘K palette — design

Roadmap item 8 (slice 3), `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`.
Saved views (slice 6) will reuse its query shape.

## Goal

Find any task fast by words in its title **or description**, from anywhere, by keyboard.
Today's header search matches task titles only (`ilike`).

Success: ⌘K / Ctrl+K (or `/`, or the header button) opens a palette; typing part of a
word in a task's description finds it, ranked; Enter opens it. A workspace's search never
returns or ranks another workspace's rows.

## Decisions

- **Palette scope:** search + actions. Tasks, projects, and a short command list.
- **Header:** the inline search box becomes a button that opens the palette. One search UI;
  `TaskSearch.tsx` is deleted.
- **Indexed content:** task title (weight A) + description (weight B). Not comments, not
  personal to-dos.
- **Matching:** prefix `to_tsquery` built server-side from sanitized tokens, OR a title
  `ILIKE` substring fallback.

Rejected: `websearch_to_tsquery` (whole words only, so `deplo` finds nothing while typing);
`pg_trgm` (typo tolerance not needed yet; extension + second index + tuning); keeping the
inline box beside the palette (two UIs to maintain); filter tokens like `assignee:me`
(belongs to slice 6).

## Data

`src/db/schema/task.ts` gains a stored generated column and a GIN index:

```ts
search: tsvector('search').generatedAlwaysAs(
  sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
),
// …
index('task_search_idx').using('gin', t.search),
```

`tsvector` is a drizzle `customType`. `drizzle-kit push` creates both and backfills existing
rows. If push cannot express the generated tsvector, a rerunnable
`src/db/sql/task-search.sql` (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
does it instead; verified on the test DB first. The column is never written by app code.

Markdown syntax in descriptions is dropped by the tokenizer; no flattening needed.

## Query

`toPrefixQuery(term): string | null` in `src/server/tasks/search-query.ts` (pure):

- split on anything that is not a Unicode letter or digit, drop empties;
- keep at most 8 tokens;
- return `tok1:* & tok2:*` (lowercased), or `null` when no tokens remain.

Its output is passed as a bound parameter to `to_tsquery('english', $1)`, never
interpolated into SQL text. Tokens hold only letters and digits, so they cannot carry
tsquery operators.

`searchTasks(ctx, term, limit = 10)` in `src/server/tasks/queries.ts`:

```
WHERE task.workspace_id = ctx.workspaceId
  AND task.archived_at IS NULL AND project.archived_at IS NULL
  AND (task.search @@ q OR task.title ILIKE pattern)
ORDER BY ts_rank(task.search, q) DESC, completed_at IS NOT NULL, updated_at DESC
LIMIT limit
```

When `toPrefixQuery` returns `null`, only the `ILIKE` branch applies and rank is 0. The
LIKE escaping stays as today (`50%` searches the literal text). The workspace filter is in
the same `WHERE`, so ranking only ever touches the caller's workspace.

`TaskSearchHit` gains `snippet: string | null`: `ts_headline('english', description, q,
'StartSel=«,StopSel=»,MaxWords=18,MinWords=6,MaxFragments=1')` when the title did not
match `q` and the description did; otherwise `null`. Rendering splits on the markers into
text and `<mark>` segments (`splitHighlights`, pure) — no raw HTML. `«`/`»` already in a
description just render as mark boundaries; harmless.

Actions in `src/server/tasks/actions.ts`:

- `searchTasksAction(workspaceSlug, term)` — unchanged signature; trims, caps at 100 chars,
  under 2 characters returns `[]`.
- `recentTasksAction(workspaceSlug)` — new, read-only: `listRecentTasks(ctx, 5)`.

## Palette UI

Built on Align UI's Command Menu, vendored as `src/components/ui/command-menu.tsx` (cmdk inside
Align `Modal`) with one local edit: its `Dialog` forwards props to `<Command>` and
`<Modal.Content>`. `src/components/shell/CommandPalette.tsx` only wires shortcuts, data and
what to list; `shouldFilter={false}`, we decide what shows. Footer shows key hints.

Open triggers:

- ⌘K (Mac) / Ctrl+K: works while typing in a field; ignored when another dialog or menu is
  open. Pressing it again while open closes the palette.
- `/`: through the existing `ignoreShortcut` rules.
- Header button: looks like today's input — search icon, "Search…", `⌘K` / `Ctrl K` kbd.
  Icon-only below `sm`.

Groups:

- Empty query: **Recent** (5, fetched on each open) and **Actions**.
- With a query: **Projects** (local case-insensitive substring, max 3), **Tasks** (server,
  200 ms debounce; results remember the term they answer, as `TaskSearch` does today), and
  **Actions** whose label matches.

Actions:

- New task — opens `CreateTaskDialog`. Its `open` state lifts into `AppHeader`, shared
  with the palette; the `c` shortcut stays.
- My To-do, Recent, Starred, Workspace settings, Account preferences.
- On a project page (from `usePathname`): Board, List, Summary for that project.

Task row: completion icon, title (struck through when done), project name on the right; a
second line with the snippet when present. Status text: "Keep typing…" (under 2 chars),
"Searching…", "No matches."

Enter or click navigates with `router.push` and closes the palette.

## Errors

- Search action fails: show "No matches." (current behavior, no toast).
- Recent fetch fails: show Actions only.

## Rollout

Schema change. The PR must say: run `yarn db:setup:prod` (and `yarn db:setup:dev` for the
develop database) **before** deploying — without `task.search` every search request
errors. Push rewrites the `task` table once to fill the column; fine at current size.

## Testing

- Unit: `toPrefixQuery` (tokens, cap, operators stripped, empty → null, Unicode letters);
  `splitHighlights`.
- Server (vitest, test DB): description-only match found with snippet; prefix `deplo`
  finds "Deployment"; identical task in another workspace never returned; archived task
  and archived project excluded; title match outranks description-only match; `50%`
  literal still matches via `ILIKE`; input `&|!:*()` returns `[]` without error;
  `recentTasksAction` scoped to the workspace.
- E2E (Playwright, run locally on :3100 — CI e2e only runs on PRs into master): ⌘K opens
  the palette; a description-only word prefix lists the task with a snippet and Enter lands
  on the task page; `/` opens it; header button opens it; "New task" action opens the
  create dialog. Specs that used the old header search are updated.

## Out of scope

Comment search, to-do search, typo tolerance, filter tokens, search result page.
