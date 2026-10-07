# Change notifications — design

Builds on `2026-10-03-calendar-reminders-design.md` (the bell and the `notification` table) and
`2026-10-07-pusher-live-refresh-design.md` (pages refresh within ~1 s of a teammate's write).
When a teammate changes a task I'm involved in, or renames, archives, unarchives or deletes a
project, I get a bell item, and if I have the workspace open, a toast.

## Goal

- Edits by others reach me as a bell item that survives a closed tab, plus a toast when a
  tab is open (arriving with the live refresh, so ~1 s with Pusher, ≤30 s on polling).
- A burst of edits by one person to one task is one bell item, not twenty.
- My own edits never notify me.
- Reminders and the daily digest are unchanged: same rows, no toast, still emailed.

## Decisions (user, 2026-10-07)

- **Delivery:** bell + toast. No email for change notifications.
- **Task recipients:** the task's assignee and creator, minus the actor. On reassignment the
  previous assignee too.
- **Task events:** any field edit (title, description, status, priority, assignee, due date,
  labels, attachments), status moves on the board, new comments, assignment on create.
- **Project recipients:** every workspace member, minus the actor.
- **Project events:** rename, archive, unarchive, delete. Not create, not color.
- **Coalescing:** merge while unread. One unread item per (recipient, subject, actor); later
  changes merge into it. Once read, the next change starts a new item.
- **Control:** one per-user toggle, default on, next to the reminder settings.
- **Approach:** notification rows written in the same transaction as the change; the toast is
  driven by the bell's unread count rising after a live refresh. No new Pusher channel.
- **Branch:** `feat/v2-updates`.

## Data

### `notification` (src/db/schema/reminder.ts)

- `notification_kind` enum gains `task_change` and `project_change`.
- New `actor_id text` → `user.id` `on delete set null`. Null for reminders and digests.
- New `project_id text` → `project.id` `on delete set null`, so a "deleted" notification
  outlives its project. Null for task and reminder kinds.
- Two partial unique indexes, the merge targets:
  - `notification_open_task_change_uq` on `(user_id, task_id, actor_id)`
    `where kind = 'task_change' and read_at is null`
  - `notification_open_project_change_uq` on `(user_id, project_id, actor_id)`
    `where kind = 'project_change' and read_at is null`
- `dedupe_key` stays `not null unique`; change rows use `chg:<newId>` (unique, never merged on).
- `task_id` keeps `on delete cascade`: deleting a task (or its project) removes its change
  rows, which is right — there is nothing left to open.

Schema goes in with `drizzle-kit push` like every earlier change (`yarn db:setup*`); adding enum
values and nullable columns is non-destructive.

### `user_settings` (src/db/schema/settings.ts)

- `change_notify boolean not null default true`. A user with no row is treated as `true`.

### Payloads (src/lib/notifications.ts, new; re-exported types used by reminders' `NotificationData`)

```ts
export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment',
] as const;

export type TaskChangeData = {
  title: string;          // task title as of the latest merged change
  projectName: string;
  actorName: string;
  changes: TaskChangeKind[];  // deduped, order of first occurrence
  assignedToYou?: true;   // recipient became the assignee in one of the merged changes
  status?: string;        // latest new status name, when 'status' is among changes
  comment?: string;       // latest comment excerpt (≤ 120 chars), when 'comment' is among changes
};

export const PROJECT_CHANGE_KINDS = ['renamed', 'archived', 'unarchived', 'deleted'] as const;

export type ProjectChangeData = {
  projectName: string;    // name before the first merged change
  newName?: string;       // latest name, when 'renamed' is among changes
  actorName: string;
  changes: ProjectChangeKind[];
};
```

`NotificationData` widens to `ReminderData | DigestData | TaskChangeData | ProjectChangeData`.

## Server

### `src/server/notifications/changes.ts` (new)

Both functions take the caller's transaction and run after the write they describe. Both
no-op when the recipient set is empty. Both are inside the transaction, so a rolled-back
write leaves no notification, and the commit that the live refresh announces already
contains the bell row.

`notifyTaskChange(ctx, tx, { taskId, changes, previousAssigneeId?, comment? })`

1. Reads the task (post-write) with its project name: `assignee_id`, `created_by`, `title`.
2. Recipients = `{assignee_id, created_by, previousAssigneeId}` − `ctx.userId` − nulls,
   filtered to current members of `ctx.workspaceId` (`member` join) whose
   `coalesce(user_settings.change_notify, true)` is true.
3. Actor name from `user.name` (one query).
4. For each recipient: `INSERT … ON CONFLICT (user_id, task_id, actor_id) WHERE kind =
   'task_change' AND read_at IS NULL DO UPDATE` with the merge below. `assignedToYou` is set
   for the recipient equal to the new assignee when `'assignee'` is among `changes`.

Merge (SQL, one fragment): `data` = incoming data, except
- `changes` = ordered union (existing first, then new kinds not already present),
- `assignedToYou` = existing OR incoming,
- `comment` / `status` = incoming when present, else existing;

`created_at = now()` so the item rises to the top of the bell. A merge does not raise the unread
count, so it does not toast again (a burst toasts once). Email columns are left alone.

`notifyProjectChange(ctx, tx, { projectId, change, projectName, newName? })`

1. Recipients = all members of `ctx.workspaceId` − `ctx.userId`, toggle on.
2. Same upsert on `(user_id, project_id, actor_id)` for `kind = 'project_change'`. Merge keeps
   the existing `projectName`, takes the incoming `newName`, ordered-unions `changes`.

The caller passes `projectName` (the name before the change) since rename and delete have
already altered or removed the row by the time the helper runs.

### Call sites

| service | when | changes |
|---|---|---|
| `createTask` | assignee set and ≠ actor | `['assignee']` |
| `updateTaskAndLabels` (via plan) | any field differs | plan kinds, plus `description` when it differs, plus `labels` when `labelIds` given and the set differs; `previousAssigneeId` on reassignment |
| `bulkUpdateTasks` | per task, same as above | plan kinds |
| `moveTask` | column crossed | `['status']` |
| `setTaskLabels` | set differs | `['labels']` |
| `createComment` | always | `['comment']` + excerpt |
| attachments add / remove | always | `['attachment']` |
| `renameProject` | row updated and name differs | `renamed` |
| `archiveProject` / `unarchiveProject` | row updated | `archived` / `unarchived` |
| `deleteProject` | before the deletes, after the ownership check | `deleted` |

Plan changes needed in `src/server/tasks/service.ts`:
- `loadOwnedTask` also selects `description`.
- `UpdatePlan` gains `changes: TaskChangeKind[]` (activity kinds mapped 1:1, plus
  `description`). Activity rows are unchanged: description edits still record no activity.
- `replaceTaskLabels` returns `ok({ changed: boolean })` (old set vs new set).

Not notified: task delete/archive (rows cascade away), comment edit/delete, subtask
creation, reordering inside a column, project create and color, status-column management.

### Email

`claimUnsentEmails` (src/server/reminders/run.ts) adds `AND kind IN ('reminder', 'digest')`.
Change rows are never claimed or emailed.

### Reads

`NotificationItem.kind` widens to all four kinds and adds `projectId`. `listNotifications` and
`unreadCount` are unchanged otherwise (unread change items count toward the badge).

## Client

### Text and links (src/lib/notifications.ts)

New `bellText(item)` and `bellHref(slug, item)` handle the two change kinds and delegate
reminder/digest items to the existing `notificationText` / `notificationHref` in
`src/lib/reminders.ts` (unchanged, so no runtime import cycle). The bell switches to them.

| kind | title | detail | href |
|---|---|---|---|
| `task_change` | task title | `assignedToYou` → "Anna assigned you"; only a comment → "Anna commented: “…”"; only status → "Anna moved to Done"; otherwise "Anna changed status, priority" | `/<slug>/tasks/<taskId>` (`/<slug>` when null) |
| `project_change` | project name (before rename) | "Anna renamed to Site v2" / "Anna archived this project" / "Anna restored this project" / "Anna deleted this project"; several: "Anna renamed, archived" | rename/unarchive: `/<slug>/projects/<projectId>`; archived: `/<slug>/settings/projects`; deleted or `projectId` null: `/<slug>` |

Field labels: title, description, status, priority, assignee, due date, labels, attachments,
comment.

### Toast (src/components/shell/NotificationBell.tsx)

- A ref holds `lastToastAt`, initialised to mount time (no toasts for what was already there).
- Whenever `unread` rises (a new server `initialUnread` after `router.refresh()`, or the focus
  re-count), the bell fetches the list and passes it to a pure
  `pickToasts(items, lastToastAt)` (src/lib/notifications.ts): unread `task_change` /
  `project_change` items with `createdAt > lastToastAt`, newest first.
- Up to 3 are shown as toasts (`toast(title, { description: detail, action: Open })`); more than 3
  shows one toast "N new updates" whose action opens the bell. `Open` navigates to the href and
  marks the item read.
- `lastToastAt` moves to the newest `createdAt` shown. Reminders and digests never toast.
- The fetched list replaces `items`, so an open popover shows fresh items too.

### Settings (src/components/settings/ReminderPrefsForm.tsx)

A switch "Changes by teammates" with hint "Bell and pop-up when someone changes a task you
created or are assigned, or renames, archives or deletes a project." Saved with the existing
form: `ReminderPrefs` gains `changeNotify: boolean`.

## Error handling

- The helpers throw like any other write in the transaction: a failed notification insert
  rolls back the edit. The upsert on the partial unique index makes concurrent edits by the
  same actor merge instead of conflicting.
- A missing or non-member recipient is filtered, not an error.
- The toast fetch failing is silent (the bell still shows the count).

## Testing

Server (vitest, `tests/server/change-notifications.test.ts`):
- Edit by Bob on a task Ada created and is assigned to → one row for Ada; none for Bob.
- Actor = assignee = creator → no rows.
- Reassign Ada → Cy by Bob: Cy gets `assignedToYou`, Ada gets `assignee`.
- Two edits by Bob → one unread row with both kinds, `created_at` bumped; mark read, third
  edit → second row.
- Different actors → separate rows.
- `change_notify = false` → skipped; non-member assignee → skipped.
- Comment → `comment` kind with excerpt; move across columns → `status`; reorder inside one
  column → nothing; labels via `setTaskLabels` unchanged set → nothing.
- Rolled-back update (unknown label) → no rows.
- Project rename/archive/unarchive → a row for every other member; archive then unarchive
  merges; delete → rows survive with `project_id` null.
- `claimUnsentEmails` skips change rows (extend `reminder-run.test.ts`).

Unit (`tests/unit/notifications.test.ts`): `notificationText` / `notificationHref` for each
kind and combination, `pickToasts` (cutoff, kinds, read items, ordering, cap).

E2E (`tests/e2e/change-notifications.spec.ts`, polling, no Pusher): Ada assigns a task to Bob
in one context; Bob's open page shows the badge and a toast, Open goes to the task. Ada renames
a project; Bob sees the project toast.
