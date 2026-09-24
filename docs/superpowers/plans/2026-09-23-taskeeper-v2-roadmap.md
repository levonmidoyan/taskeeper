# Taskeeper v2 — Deferred Scope Roadmap

**Source:** `docs/superpowers/specs/2026-09-20-taskeeper-design.md` §9 (Deferred), §2 non-goals.
**Status of v1:** complete on `feat/taskeeper-v1` (`9b078c7..3ff2cc0`).

This is a sequencing document, not an implementation plan. Each slice below gets its own
plan in `docs/superpowers/plans/` when it is reached, written with the
`superpowers:writing-plans` skill and executed task-by-task. Only Slice 1 has a plan today:
`docs/superpowers/plans/2026-09-23-comments-and-activity.md`.

## Ordering

Spec §9's value order, with two items pulled forward: per-user timezone (small, and it
changes the signature every later date-touching feature reads) and full-text search (cheap
in Postgres, high daily value, and saved filters want its query shape).

| # | Slice | Why here | Schema delta | Rough size |
|---|---|---|---|---|
| 1 | Comments + activity log | Highest stated value; additive tables only | `comment`, `task_activity` | 6 tasks |
| 2 | Per-user timezone overrides | Smallest; widens `WorkspaceContext` before 4 slices start reading it | `user_settings` | 3 tasks |
| 3 | Full-text search | Cheap; saved filters reuse its query builder | `tsvector` column + GIN index on `task` | 4 tasks |
| 4 | Rich-text descriptions | Self-contained; blocks nothing | `task.description` text → jsonb | 5 tasks |
| 5 | Calendar view + Vercel Cron reminders | Needs §2 (per-user zone) to send a reminder at the right local hour | `reminder`, `notification` | 7 tasks |
| 6 | Saved filters and views | Needs §3's filter predicates to exist first | `saved_view` | 4 tasks |
| 7 | Custom per-project properties | Largest schema surface; touches every task read | `project_property`, `task_property_value` | 8 tasks |
| 8 | Realtime sync | Constrained by §7 deployment (no `LISTEN` under PgBouncer) | none | 5 tasks |
| 9 | Public share links | Needs a second, read-only auth path past `requireWorkspace` | `share_link` | 4 tasks |
| 10 | Mobile app / REST layer | Last: it freezes `server/*` signatures as a public contract | none | 6 tasks |

## Constraints that carry into every slice

Every global constraint in `docs/superpowers/plans/2026-09-20-taskeeper-v1.md` still holds
verbatim — Yarn 4, pinned versions, Node runtime only, no session-level Postgres state, no
component imports from `src/db/`, `ctx: WorkspaceContext` first parameter on every
`src/server/**` export, `Result<T>` across the action boundary, semantic Tailwind tokens,
Lucide icons only, dates through `src/lib/dates.ts`, `TZ=UTC`, TDD, Conventional Commits,
no `Co-Authored-By` trailers.

Two additions that these slices introduce:

- **New tables must be added to the `TRUNCATE` list in `tests/setup/db.ts`.** A table
  missing there leaks rows between tests and the failure surfaces far from its cause.
- **Anything that records who did what takes the actor from `ctx.userId`, never from
  input.** Same reasoning as the denormalized `task.workspace_id` in spec §3.3.

## Slice notes

**1. Comments + activity log.** Two additive tables, one merged feed query, one panel
section in `TaskDetailDialog`. Activity rows are written in the same transaction as the
mutation that caused them, and store display text (status *name*, member *name*), not ids,
so a deleted column still renders its history. Plan written.

**2. Per-user timezone overrides.** `user_settings(user_id pk, timezone text null)`. A null
means "follow the workspace". `resolveWorkspace` left-joins it and `WorkspaceContext.timezone`
becomes the resolved per-user value; a new `workspaceTimezone` field keeps the workspace zone
available for anything that must be workspace-wide (reminder scheduling windows). Risk: every
existing timezone test asserts the workspace zone — they stay green only if the fallback is
exact.

**3. Full-text search.** A generated `tsvector` column over `title || description`, GIN
indexed, queried with `websearch_to_tsquery`. Workspace-scoped by `task.workspace_id` in the
same `WHERE`, never as a post-filter. A `⌘K` palette over `searchTasks(ctx, q)`. Risk:
ranking a workspace's results must never require reading another's rows.

**4. Rich-text descriptions.** `task.description` becomes jsonb holding a document node.
Migration converts existing plain text into a single paragraph node; the reverse direction
(jsonb → text) must exist for export and for the search vector, which indexes the flattened
text. Editor choice is a brainstorming input, not settled here.

**5. Calendar view + reminders.** A month grid over `due_date` plus a Vercel Cron route that
runs hourly, selects due tasks whose recipient's local hour matches their reminder hour, and
writes a `notification` row before sending. Idempotency is the whole problem: the cron may
fire twice, so the send is keyed on `(task_id, user_id, due_date)` unique.

**6. Saved filters and views.** `saved_view(id, workspace_id, project_id null, owner_id,
name, filter jsonb, shared boolean)`. The filter jsonb is parsed by a Zod schema and compiled
to Drizzle predicates server-side — never interpolated.

**7. Custom per-project properties.** `project_property(id, project_id, name, type, options
jsonb, position)` and `task_property_value(task_id, property_id, value jsonb)`, composite PK.
Adds a second round trip to every task read; budget a query-shape task for it. Largest slice —
likely splits into two plans (definition/admin, then values/rendering).

**8. Realtime sync.** Spec §7 forbids `LISTEN`/`NOTIFY` under PgBouncer transaction pooling,
so this is polling with an `updated_at` cursor or an external broker (Pusher/Ably). Decide
before planning; the two shapes share no code.

**9. Public share links.** `share_link(token, workspace_id, project_id, expires_at, revoked_at)`
and a route group outside `(app)` that resolves a read-only pseudo-context. The risk is that
every `src/server/**` function assumes an authenticated member; the read path needs its own
narrow query set rather than reusing the member queries with a fake `ctx`.

**10. Mobile / REST layer.** Route handlers under `src/app/api/v1/*` that authenticate a
token, build a real `WorkspaceContext`, and call the same `server/*` functions. Doing this
last means the signatures have stopped moving.
