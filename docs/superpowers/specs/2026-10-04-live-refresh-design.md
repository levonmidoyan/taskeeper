# Live refresh (polling) — design

Roadmap item 11 (slice 8), `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`.
The roadmap listed this as "decision only". Decision (2026-10-04): build polling now, shaped
so a Pusher transport can replace it later without touching services or pages.

## Goal

A teammate's change shows up on my screen without a reload, and never interrupts what I am
doing.

Success:

- Any change to shared workspace data (a card moved, a comment added, a project renamed, a
  member added) reaches every open tab of every member of that workspace within ~30 s while
  the tab is visible, and right away when the tab regains focus.
- My own edits do not trigger a second, redundant refresh.
- A refresh never lands mid-drag, mid-typing or while one of my mutations is in flight; it
  waits and runs once I am idle.
- Adding Pusher later means one new transport and one publish call in one helper.

## Decisions

- **Mechanism:** polling now; Pusher later. No `LISTEN`/`NOTIFY` (spec §7, PgBouncer) and
  no self-hosted SSE/WebSocket (Vercel functions).
- **Scope:** one change stamp per workspace (option A). Any shared change refreshes every
  page under `/[workspaceSlug]`, including the notification bell. Events carry an optional
  `projectId` so per-project filtering can be added later without a redesign.
- **Emit point:** service level, inside the mutation's transaction, next to the existing
  `recordActivity` calls. No DB triggers, no emit from actions.
- **Busy behaviour:** apply silently, but defer while dragging, typing or while a mutation
  is in flight.
- **Interval:** 30 s while visible; immediate check on focus/visible; backs off to 2 min
  after 5 min with no pointer or keyboard input; no polling while hidden.
- **Private data does not emit:** todos, project stars, private saved views, my reminders,
  notification reads. The Todo page does not poll.

## Data

### `workspace_change` (new, `src/db/schema/change.ts`)

| column | type | notes |
|---|---|---|
| `workspace_id` | `text` PK | FK `organization.id`, `on delete cascade` |
| `version` | `bigint` not null | starts at 1, +1 per emit |
| `changed_at` | `timestamptz` not null | `now()` on every emit |

Bumped with one statement:

```sql
INSERT INTO workspace_change (workspace_id, version, changed_at) VALUES ($1, 1, now())
ON CONFLICT (workspace_id) DO UPDATE
  SET version = workspace_change.version + 1, changed_at = now();
```

A missing row reads as version `0`, so existing workspaces need no backfill. One row per
workspace means a single-row lock per mutation; that is fine at this app's write rate.
Added to the `TRUNCATE` list in `tests/setup/db.ts`.

## Server (`src/server/changes/`)

- `emitChange(ctx: WorkspaceContext, scope: { projectId?: string }, tx)`: runs the upsert
  on `tx`. `scope` is unused by polling today; it is the payload a Pusher publish will send.
- `emitChangeFor(workspaceId: string, tx)`: same upsert, for paths with no
  `WorkspaceContext` (invitation accept/decline, the cron, account deletion).
- `getWorkspaceVersion(ctx)`: `select version`, `0` when no row.

When Pusher lands, `emitChange` also queues a publish that runs after the transaction
commits. That is the only server change Pusher needs.

### Who emits

Shared data, inside the existing transaction (a function that has none gets one):

- **tasks:** `createTask`, `updateTask`, `moveTask`, `deleteTask`, `bulkUpdateTasks`,
  `bulkDeleteTasks` (with `projectId`).
- **statuses:** `createStatus`, `updateStatus`, `moveStatus`, `deleteStatus`.
- **projects:** `createProject`, `renameProject`, `setProjectColor`, `archiveProject`,
  `unarchiveProject`, `deleteProject`. Not `setProjectStar`.
- **comments:** `createComment`, `updateComment`, `deleteComment`.
- **attachments:** `confirmUpload`, `deleteAttachment`. Not `requestUpload` /
  `cancelUpload` (an unconfirmed upload is invisible to others).
- **labels:** `createLabel`, `setTaskLabels`, `deleteLabel`.
- **members:** `inviteMember`, `removeMember`, `changeMemberRole`; `acceptInvitation` and
  `declineInvitation` take no `WorkspaceContext`, so they use `emitChangeFor` with the
  invitation's workspace (the pending-invite list in Members settings changes).
- **settings:** `updateWorkspaceSettings`.
- **views:** `createView`, `updateView`, `duplicateView`, `deleteView`, only when the view
  is shared before or after the write (going private→shared or shared→private emits).
- **reminders cron** (`src/server/reminders/run.ts`): once per workspace that got new
  notifications in the run, so recipients' bells update.
- **account deletion** (`src/server/account/deletion.ts`): once per workspace the user
  belonged to.

Functions that write nothing (validation failure, no-op update) do not emit.

## Poll endpoint

`GET /api/workspaces/[slug]/changes` → `200 { version: number }`.

- Session from `auth.api.getSession`, as in `src/app/api/attachments/[id]/route.ts`.
  No session → `401`.
- Not a member, or no such workspace → `404` (same answer for both; no existence leak).
- `Cache-Control: private, no-store`.
- One indexed read (membership + `workspace_change`); no other work.

## Client

### `<LiveRefresh>` (`src/components/shell/LiveRefresh.tsx`)

- `WorkspaceLayout` reads `getWorkspaceVersion(ctx)` and passes it to `WorkspaceShell`,
  which mounts `<LiveRefresh slug={…} version={…} />` once per workspace.
- The `version` prop is the **seen** version. My own mutation already revalidates or
  calls `router.refresh()`; the layout re-renders with the bumped version, so the next
  poll matches and nothing happens.
- When the transport reports `version > seen`, a refresh becomes **pending**. It runs
  `router.refresh()` as soon as the page is not busy. Several changes while busy collapse
  into one refresh.
- Inactive when the pathname ends in `/todo`.

### Transport (`src/lib/live/transport.ts`)

```ts
export type ChangeTransport = {
  subscribe(onVersion: (version: number) => void): () => void;
};
```

`createPollingTransport(slug, options?)`:

- Fetches the endpoint every 30 s while `document.visibilityState === 'visible'`; none
  while hidden.
- Checks right away on `visibilitychange` → visible and on window `focus`.
- After 5 min with no `pointerdown` / `keydown`, the interval becomes 2 min; the next
  input restores 30 s.
- Network or 5xx errors are ignored; the next tick retries.
- `401` or `404` stops the transport (signed out or removed from the workspace).
- Its fetch sends a `x-live-poll: 1` header so the request tracker skips it (the top
  loading bar must not flash every 30 s, and the poll must not count as "busy").
- Interval and idle thresholds are options, so tests (and e2e via
  `NEXT_PUBLIC_LIVE_POLL_MS`) can shorten them.

A `createPusherTransport` later implements the same type; `<LiveRefresh>` picks one by env.

### Busy detection (`src/lib/live/busy.ts`)

The page is busy when any of these is true:

- **Drag:** a small registry, `markBusy(key)` / `releaseBusy(key)`, called from
  `onDragStart` and `onDragEnd` / `onDragCancel` in the kanban (`kibo-ui/kanban`),
  `CalendarMonth`, `ManageColumnsDialog` and `TaskTableSettings`.
- **Typing:** `document.activeElement` is an `input`, `textarea`, `select` or
  contenteditable element.
- **Mutation in flight:** `getPendingRequests() > 0` from `src/lib/request-tracker.ts`.

`subscribeBusy(listener)` fires on registry changes, `focusin` / `focusout` and request
settle. `<LiveRefresh>` re-checks on each of these and flushes the pending refresh when the
page becomes idle.

## Errors and edge cases

- A refresh that re-renders an open task dialog keeps its client state (draft text, open
  pickers).
- The task or project I am viewing is deleted by someone else: the refresh hits the existing
  `notFound()`. Accepted.
- I am removed from the workspace: the poll gets `404` and stops; my next navigation hits the
  existing membership check.
- Clock skew does not matter; versions are integers from one row.

## Security

- The endpoint reveals only an integer counter, and only to members. Non-members and
  unknown slugs get the same `404`.
- No input is taken except the slug from the path.
- The future Pusher channel must be private (`private-workspace-<id>`) with an auth endpoint
  doing the same membership check. Out of scope here.

## Testing (TDD)

- **vitest, services:** for every emitting function above, one assertion that the version
  went up by exactly 1, and for each excluded write (star, private view, todo, reminder,
  mark read, failed validation) that it did not.
- **vitest, endpoint:** `401` without session, `404` for non-member and unknown slug,
  `200 { version }` for a member, `no-store` header.
- **vitest, transport:** fake timers + mocked `fetch` and `visibilityState`: 30 s ticks,
  none while hidden, immediate check on visible/focus, idle backoff and recovery, stop on
  401/404, errors ignored.
- **vitest, busy + LiveRefresh logic:** pending refresh deferred while dragging / typing /
  request in flight, flushed once on idle, collapsed when several versions arrive; no
  refresh when polled version equals the seen prop.
- **e2e** (two browser contexts, two members, `NEXT_PUBLIC_LIVE_POLL_MS=1000`):
  member B moves a card and member A's board shows it without reload; A types in the comment
  composer, B changes the task, A's refresh waits until A blurs, and A's draft survives.

## Deploy

New table: run `yarn db:setup:prod` / `db:setup:dev` **before** deploying. Without the table
every mutation fails (the emit runs in the mutation's transaction).
