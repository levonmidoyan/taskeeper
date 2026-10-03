# Calendar view + reminders — design

Roadmap item 9 (slice 5), `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`.
Builds on slice 2 (per-user timezone): a reminder is sent at the recipient's local hour.

## Goal

See work by due date, move it by dragging, and get told about it without opening the app.

Success:

- A project's tasks with due dates appear on a month grid; dragging one to another day
  changes its due date and survives a reload.
- "My calendar" shows the tasks assigned to me across every active project.
- Each member gets at most one digest per workspace per local day listing what is due
  today and overdue, by email and in an in-app bell.
- Any member can set personal reminders on a task ("on the day", 1, 2 or 7 days before).
- The cron can fire twice, late, or overlap itself and nobody gets a duplicate email.

## Decisions

- **Vercel plan:** Hobby today, Pro later. Code is hourly-ready; `vercel.json` ships a
  daily schedule. Upgrading changes only the schedule string and one config constant.
- **Calendar placement:** a 4th project view tab (`Calendar`) + a workspace rail page
  (`My calendar`).
- **Drag to reschedule:** yes, optimistic, through the existing `updateTaskAction`.
- **Channels:** email + in-app bell, both fed by the `notification` table.
- **Reminder kinds:** an automatic daily digest (opt-out) + optional per-task reminders.
- **Per-task recipient:** whoever set the reminder (personal), not the assignee.
- **Send selection:** computed on every run ("due at or before now"), not stored.
- **Calendar component:** our own month grid built from Align UI atoms + dnd-kit.

Rejected:

- Storing `fire_at` per reminder (must be recomputed on every due-date, timezone or hour
  change; the digest has no row to hang it on).
- An external scheduler (QStash / Inngest): new vendor, secrets and cancel bookkeeping.
- Kibo UI `calendar`: global jotai month state (not per-page, not in the URL), compares
  bare dates as local `Date`s (off by one west of UTC), no drag, no today, new deps
  (`date-fns`, `jotai`, `lucide-react`) and shadcn primitives.
- ReUI event calendar: shadcn primitives to re-port, its own pointer-drag engine beside
  dnd-kit, `@date-fns/tz`, timed-event model we don't need.
- FullCalendar: ~150 KB, owns its DOM and CSS (fights Align tokens), weak mobile and
  keyboard drag. react-big-calendar: localizer + `react-dnd`. Schedule-X: drag is paid.
- One digest across all workspaces: zone and membership are per workspace.

## Data

### `user_settings` (two new columns)

| column | type | notes |
|---|---|---|
| `reminder_hour` | `smallint not null default 9` | 0–23, local hour for digest and reminders |
| `digest_enabled` | `boolean not null default true` | daily digest on/off |

A user with no `user_settings` row gets the defaults (the query `coalesce`s).

### `reminder`

| column | type | notes |
|---|---|---|
| `id` | `text` PK | |
| `workspace_id` | `text` → `organization` cascade | denormalized, as on `task` |
| `task_id` | `text` → `task` cascade | |
| `user_id` | `text` → `user` cascade | always `ctx.userId` |
| `offset_days` | `smallint not null` | one of `0, 1, 2, 7` (check constraint) |
| `created_at` | `timestamptz not null default now()` | |

Unique `(task_id, user_id, offset_days)`.

### `notification`

| column | type | notes |
|---|---|---|
| `id` | `text` PK | |
| `user_id` | `text` → `user` cascade | recipient |
| `workspace_id` | `text` → `organization` cascade | |
| `kind` | enum `notification_kind` (`digest`, `reminder`) | |
| `task_id` | `text null` → `task` cascade | reminders only |
| `dedupe_key` | `text not null unique` | the idempotency claim |
| `data` | `jsonb not null` | display snapshot (below) |
| `read_at` | `timestamptz null` | |
| `email_claimed_at` | `timestamptz null` | send lock |
| `email_sent_at` | `timestamptz null` | |
| `email_attempts` | `smallint not null default 0` | |
| `created_at` | `timestamptz not null default now()` | |

Index `(user_id, workspace_id, created_at desc)` for the bell; partial index on
`created_at` where `email_sent_at is null` for the email step.

Dedupe keys:

- Reminder: `rem:{taskId}:{userId}:{dueDate}:{offsetDays}`. A moved due date is a new key,
  so the reminder fires again for the new date.
- Digest: `dig:{userId}:{workspaceId}:{localDate}`.

`data` snapshots what the bell and email show, so a later rename does not rewrite history
and the bell needs no join:

- Reminder: `{ title, projectName, dueDate, offsetDays }`.
- Digest: `{ localDate, dueToday: number, overdue: number, tasks: [{ id, title, dueDate }] }`
  (`tasks` capped at 20).

Both tables join the `TRUNCATE` list in `tests/setup/db.ts`.

## Reminder pipeline

`GET /api/cron/reminders`, scheduled in `vercel.json` as `0 6 * * *` (daily, Hobby).
Moving to Pro: `0 * * * *` and flip `REMINDER_CRON_HOURLY` in `src/lib/reminders.ts`.

The `CRON_SECRET` bearer check moves from `sweep-attachments/route.ts` into
`src/lib/cron.ts` (`cronAuthorized(request)`); both routes use it. The route calls
`runReminders(now)` from `src/server/reminders/run.ts`. Like `sweepAttachments`, this is a
system job and takes no `ctx`. `maxDuration = 300`.

### 1. Select (SQL only)

Postgres does all zone arithmetic. For each recipient:

```
zone   = coalesce(user_settings.timezone, workspace_settings.timezone)
hour   = coalesce(user_settings.reminder_hour, 9)
moment(day) = (day + make_time(hour, 0, 0)) AT TIME ZONE zone      -- timestamptz
```

- **Reminder candidates:** `reminder ⋈ task ⋈ project ⋈ member(task.workspace_id,
  reminder.user_id)`; `moment(task.due_date - offset_days)` in `(now - 36h, now]`.
- **Digest candidates:** members with `digest_enabled`; `local_today = (now AT TIME ZONE
  zone)::date`; `moment(local_today)` in `(now - 36h, now]`; at least one task assigned to
  them with `due_date <= local_today`.

Filters on both: task has a due date, task not archived, task status not `is_done`,
project not archived, recipient still a member of the workspace.

The 36 h lookback covers the 24 h gap between daily runs plus slack, and stops a burst of
stale reminders after a reminder is set on a long-past date.

### 2. Claim

`INSERT INTO notification … ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`. Only
returned rows are new. The bell sees them immediately.

### 3. Email

```
UPDATE notification
SET email_claimed_at = now(), email_attempts = email_attempts + 1
WHERE id IN (
  SELECT id FROM notification
  WHERE email_sent_at IS NULL AND email_attempts < 3
    AND created_at > now() - interval '36 hours'
    AND (email_claimed_at IS NULL OR email_claimed_at < now() - interval '10 minutes')
  ORDER BY created_at LIMIT 500
  FOR UPDATE SKIP LOCKED
)
RETURNING …
```

Two overlapping runs cannot claim the same row. Each claimed row is sent; success sets
`email_sent_at`, failure leaves it null for the next run (after the 10-minute lock), up to
3 attempts. One failing send does not stop the batch. The route returns
`{ claimed, emailed, failed, skipped }`.

Claim and email are separate on purpose: a Resend outage delays email but never loses or
duplicates it, and the bell is unaffected.

### Emails

React Email templates in `src/lib/email.tsx`, same Resend client, sender and Align colors:

- **Reminder:** subject `“{title}” is due {today|tomorrow|in N days}`; project, date, Open
  task button (`/{slug}/tasks/{id}`).
- **Digest:** subject `{n} due today · {m} overdue in {workspace}`; list (20 max, then
  "and N more"), View my calendar button.

With no `RESEND_API_KEY`, sending behaves as the auth emails already do.

## Calendar

### Component

`src/components/calendar/`:

- `month-grid.ts` — pure: `monthWeeks(month: 'YYYY-MM', weekStart: 0|1): string[][]` of
  `YYYY-MM-DD` days (leading/trailing days included), `parseMonthParam`, `shiftMonth`.
  Uses `src/lib/dates.ts` string days only; no `Date` comparisons.
- `CalendarMonth.tsx` — client. Header (month label, ‹ › `CompactButton`s, Today
  `Button`), weekday row (`Intl`, from `weekStart`), 6-week grid. Day cell = dnd-kit
  droppable; chip = draggable. Today highlighted (`todayInZone`), out-of-month days muted.
- `CalendarChip.tsx` — status icon, title (truncated), assignee `Avatar`; project color
  dot on My calendar; done = struck through + muted; overdue = tinted. Click opens the task
  dialog.
- More than 3 chips → "+N more" opens an Align `Popover` with the full day list (chips
  there are draggable too).
- Phone width: grid becomes a vertical list of days with tasks in the visible month.

The visible month lives in `?m=YYYY-MM` (invalid or missing → current month in the user's
zone), so views are linkable and survive reload. ‹ › are links, not client state.

### Drag

dnd-kit `DndContext` with pointer + keyboard sensors (as the board). Drop on a day →
optimistic move → `updateTaskAction(slug, taskId, { dueDate })`. On error: roll back +
toast. Dropping on the same day is a no-op. The task dialog's due-date field remains the
non-drag path.

### Routes and query

- `/[workspaceSlug]/projects/[projectId]/calendar` — new `ViewTabs` entry
  (Summary / Board / List / Calendar). All non-archived tasks in the project with a due
  date in range.
- `/[workspaceSlug]/calendar` — rail entry "My calendar". Tasks assigned to `ctx.userId`
  across non-archived projects.

One query: `listCalendarTasks(ctx, { from, to, projectId } | { from, to, mine: true })`
in `src/server/tasks/`, range capped at 42 days, returns
`{ id, title, dueDate, statusIcon/color, isDone, assignee, project: { id, name, color } }`.

## Per-task reminders

- `src/server/reminders/`: `listMyReminders(ctx, taskId)`,
  `setTaskReminders(ctx, taskId, offsets: (0|1|2|7)[])` — Zod-validated, task must be in
  `ctx.workspaceId`, replaces my set in one transaction. Actions return `Result<T>`.
- Task dialog field "Remind me": multi-select (On the day / 1 / 2 / 7 days before), bell
  glyph when set. Shows only my reminders. Disabled with a hint when the task has no due
  date (rows are kept if the date is cleared; they fire again once a date is set).

## Bell

- `AppHeader`, beside the ⌘K trigger: bell `CompactButton` + unread count badge.
- Popover lists the latest 30 notifications for `ctx.userId` in this workspace. Reminder →
  opens the task; digest → My calendar. Opening an item marks it read; "Mark all read".
- Count is server-rendered with the shell and refreshed on window focus. No realtime
  (slice 8 decides that).
- `src/server/notifications/`: `listNotifications(ctx)`, `unreadCount(ctx)`,
  `markRead(ctx, id)`, `markAllRead(ctx)` — every query scoped to
  `user_id = ctx.userId AND workspace_id = ctx.workspaceId`.

## Preferences

Account → Preferences (beside timezone): "Daily digest" `Switch` and "Reminder time" hour
`Select` (00:00–23:00), applied to both digest and reminders. While
`REMINDER_CRON_HOURLY` is false, a hint reads "Delivered once a day on the current plan."
Saved through the existing `user-settings` service (`ctx: UserContext`).

## Errors

- Drag: optimistic, rollback + toast on `Result` error.
- Calendar params: bad `?m=` → current month; range > 42 days rejected by the query.
- Reminder / notification actions: membership and ownership from `ctx`; never trust input
  for `user_id`.
- Cron: 401 without the secret; per-row try/catch; counts in the response for Vercel logs.

## Testing (TDD)

- **Unit:** `month-grid` (week start 0/1, leading/trailing days, Feb in leap year, month
  shift across years); dedupe-key builders; email templates (subject, 20-item cap).
- **Server (real Postgres):** selection across zones (Asia/Yerevan, America/Los_Angeles,
  user override), hour boundary (moment == now included, now−36h excluded); exclusions
  (done, archived task, archived project, ex-member, digest-disabled, empty digest);
  double run → one notification and one email; email failure → retried, stops at 3;
  concurrent email claim; reminder and notification authorization; `listCalendarTasks`
  range / project / mine.
- **Route:** 401 without secret; happy path with Resend mocked.
- **E2E (Playwright, :3100):** project Calendar shows a task on its day, drag to another
  day, reload → persisted; My calendar shows only my tasks; set "1 day before" in the
  dialog; seeded notification → bell count → open → read; Preferences digest toggle and
  hour persist.

## Deploy

No new env vars (`CRON_SECRET`, `RESEND_API_KEY` already exist). Run `yarn db:setup:prod`
**before** deploying: new tables, enum and `user_settings` columns.
