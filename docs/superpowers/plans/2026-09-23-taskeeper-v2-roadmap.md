# Taskeeper v2 — Deferred Scope Roadmap

**Source:** `docs/superpowers/specs/2026-09-20-taskeeper-design.md` §9 (Deferred), §2 non-goals.
**Status of v1:** released as `1.0.0` (tag on `209a3c6`, 2026-10-03).

This is a sequencing document, not an implementation plan. Each slice below gets its own
plan in `docs/superpowers/plans/` when it is reached, written with the
`superpowers:writing-plans` skill and executed task-by-task. Only Slice 1 has a plan today:
`docs/superpowers/plans/2026-09-23-comments-and-activity.md`.

## Priority order (2026-10-03)

Set after the 1.0.0 release; supersedes the value order in **Ordering** below. The slice
table and slice notes stay as the design reference for each slice.

**P0: before real users touch prod** — done with 1.0.0.

1. ~~Prod R2 and `CRON_SECRET`.~~
2. ~~One green CI run on GitHub Actions with the MinIO service.~~
3. ~~Attachment ✕ bug: dismissing an upload before confirm left the file attached.~~
4. ~~Real-browser crawl of every route as admin and member, with overdue, archived and empty data.~~
5. ~~Release version: `1.0.0`.~~

**P1: small, high value**

6. Project archive / unarchive UI. The services and actions exist in `src/server/projects/`,
   but no component calls archive, unarchive, rename or delete, so a project can be neither
   archived nor brought back from the UI.
7. Slice 2: per-user timezone. Must land before reminders.
8. Slice 3: full-text search + ⌘K. Today's `ilike` search covers titles only.

**P2: core team features**

9. Slice 5: calendar + reminders. Cron and email already exist.
10. Slice 6: saved filters and views, on slice 3's filter predicates.
11. Slice 8: realtime sync, decision only. Leaning to polling on an `updated_at` cursor; build
    after P2 only if teammates see stale boards.

**P3: bigger or more niche**

12. Slice 9: public share links. New read-only auth path; needs a security review.
13. Slice 7: custom per-project properties. Only if custom fields are actually needed.

**P4: last or optional**

14. Slice 10: REST API / mobile. Last on purpose: it freezes `server/*` signatures.
15. Polish: coloured status dots on board columns; relative dates on attachment cards; a test
    for the 401 response on the attachment route.
16. Slice 4: rich text — closed. Shipped as Markdown through Tiptap (`@tiptap/markdown`);
    `task.description` stays `text`, not the `jsonb` the slice note below planned.

Slice 1 (comments + activity log) shipped in v1.

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
