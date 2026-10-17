# Subtasks UX — Design

**Branch:** `feat/changes` (with the other unpushed UI changes), PR into `develop`.
**Date:** 2026-10-14. Approved in conversation section by section.

## 1. Goal

Subtasks work today but feel bare and confusing: they live only inside the parent's detail
view as title + done toggle + hover trash, clicking a title swaps the whole view to the
subtask with only a small way back, the board and list show just a `2/5` count, and the list
reorders itself whenever a subtask changes status.

**Success:** a user breaks a task into steps by typing or pasting lines into an always-visible
field, sees and changes each step's status, assignee and due date without leaving the
parent, renames and drags steps into order, and that order holds when a step is ticked done.
From the board or list they can expand a task to see and tick its steps. When they do open a
subtask, it is obvious whose subtask it is and they can step to siblings or back to the
parent in one click or key. A task can become a subtask of another and back.

**Decisions taken:**

| Question | Decision |
|---|---|
| Pain points addressed | All four: bare rows, confusing open, hidden on board/list, clunky management |
| Click on a subtask | Rich row edits fields inline; explicit open icon; opened subtask gets parent banner + sibling prev/next |
| Board/list | Collapsed-by-default expand toggle: mini checklist on board cards, indented child rows in list |
| Extras | Drag reorder, inline rename, convert task↔subtask, bulk add by paste |
| Order storage | New `subtaskPosition` column scoped to parent (status changes never move it) |
| Board/list data | Loaded eagerly with the page queries; live refresh keeps it current |

**Non-goals:** REST API write support for reorder / parent change (reads get the new order
only), nesting deeper than one level, subtasks as their own cards in board columns.

## 2. Data and server

### 2.1 Schema

`src/db/schema/task.ts`: add `subtaskPosition: text('subtask_position')` (nullable) and index
`task_parent_position_idx` on `(parentTaskId, subtaskPosition)`. Top-level tasks keep it
`null`; every subtask has one.

Backfill: `src/db/sql/subtask-position-backfill.sql` (run by `db:setup` after `drizzle-kit push`,
safe to rerun) copies `position` into `subtask_position` for subtasks that have none.
`position` values are already valid fractional keys and sorting by them (then `id`) is today's
displayed order, so the order is kept. Keys may tie across columns; reorder renumbers on a tie
and reads tie-break by `id`. Production needs `db:setup:prod` after deploy.

### 2.2 Service (`src/server/tasks/service.ts`)

- **Create.** A subtask create sets `subtaskPosition` after its last sibling (read under a
  `FOR UPDATE` lock on the parent row). Batch form: `createSubtasks({ parentTaskId, titles })`,
  1–50 trimmed non-empty titles, one transaction, one `created` activity row per subtask,
  keys from `positionsForCount` appended after the last sibling.
- **Reorder.** `reorderSubtask({ taskId, beforeId, afterId })`, same contract as `moveTask`:
  the client sends neighbours, the server computes the key. Locks the parent row so two drags
  serialize. Neighbours must be siblings (same `parentTaskId`, same workspace) or `null` for
  an edge; anything else → "That move is not valid." Reversed neighbours → `STALE_MOVE`. Tied
  keys → renumber the siblings in displayed order, then place between the new keys.
- **Status change.** `applyUpdate` keeps resetting `position` on column change (board key
  space) and never touches `subtaskPosition`, so a ticked subtask stays where it was.
- **Parent change.** `setTaskParent({ taskId, parentTaskId: string | null })`:
  - *Make subtask:* target parent in same project and workspace, top-level, not archived, not
    the task itself; the task must have no subtasks of its own → else
    "Tasks with subtasks can’t become subtasks." Sets `subtaskPosition` after the new last
    sibling. Status kept.
  - *Promote:* `parentTaskId = null`, `subtaskPosition = null`, `position` recomputed to the
    end of its column so it cannot tie with a board key.
  - Activity on the moved task: `parent` kind, "made this a subtask of X" / "promoted this to a
    task". Change notification kind `parent` to watchers of the moved task. `activity.kind`
    is plain text, so this only adds `'parent'` to `TASK_CHANGE_KINDS`
    (`src/lib/notifications.ts`) and a renderer in the activity feed; no enum migration.
  - No-op (same parent) returns ok without writes.

Server actions in `src/server/tasks/actions.ts` wrap each: `createSubtasksAction`,
`reorderSubtaskAction`, `setTaskParentAction`, following the existing `Result` pattern.

### 2.3 Queries (`src/server/tasks/queries.ts`)

- `getTaskDetail`: subtasks ordered by `subtaskPosition`, `id`. When the task is itself a
  subtask, add `siblings: { id: string; title: string }[]` in the same order (includes self).
- `listProjectTasks(ctx, projectId, filter, { withSubtasks: true })` (board and project List
  pages; Summary does not ask): each row gains `subtasks: TaskRow[]` (full rows with labels),
  one extra query `WHERE parentTaskId IN (ids) AND archivedAt IS NULL ORDER BY subtaskPosition, id`.
  Subtasks are not filtered by the view filter; their parent is.
- The workspace "All tasks" page and the REST API are unchanged.

## 3. Parent's subtask list (detail view)

Rebuild `src/components/task/SubtaskSection.tsx`, splitting the row into `SubtaskRow.tsx`.

### 3.1 Header

`Subtasks 3/5` plus a thin progress bar (done / total; success colour at 100%). Section stays
collapsible. The header "Add subtask" button goes away (the add row is always there).

### 3.2 Row

Desktop, left to right:

`drag handle` · `done toggle` · **title** · `status` · `assignee` · `due` · `open ↗` · `⋯`

- Handle, open and ⋯ fade in on row hover or focus-within; always visible on touch
  (`@media (hover: none)`), as the trash button is today.
- **Status:** compact dropdown showing `StatusIcon` + name, options are the project's
  statuses. Done toggle keeps its current behaviour (`doneToggleTarget`), so toggle and
  dropdown always agree.
- **Assignee:** `AssigneePicker` in a compact avatar trigger; unassigned shows a dashed
  avatar placeholder.
- **Due:** `DueChip`; click opens the `DueDateField` popover. No date shows a calendar icon
  only on hover/focus.
- Below `lg`: title on the first line, status / assignee / due wrap to a second line; drag
  handle hidden, reorder through ⋯ → Move up / Move down.
- All field changes use `updateTaskAction` with optimistic UI and revert + toast on error.

### 3.3 Title

Single click on the title turns it into an input in place. Enter or blur saves (empty →
revert), Escape reverts, same convention as description and comment edits (including the
`LOCAL_ESCAPE_EVENT` hand-off inside dialogs). Opening moves to the ↗ icon and ⋯ → Open.

### 3.4 ⋯ menu

Open · Move up · Move down · Promote to task · Delete (existing confirm dialog).
Move up/down are disabled at the ends.

### 3.5 Reorder

dnd-kit `SortableContext` with vertical strategy, pointer + touch + keyboard sensors
(pattern from `TodoItem.tsx` / `TaskTableSettings.tsx`). `Alt+↑` / `Alt+↓` on a focused row
moves it one place. Optimistic `arrayMove`, then `reorderSubtaskAction` with the new
neighbours; on error revert and toast, on `STALE_MOVE` also `router.refresh()`.

### 3.6 Add row

Always visible as the last row: `+ Add subtask…` ghost input (no hidden button). Enter
creates and keeps focus, cleared up front as today. Paste containing newlines is intercepted:
lines are trimmed, empties dropped; if more than one remains the row shows
"Create N subtasks? Enter to confirm · Esc to paste as one line". Enter → `createSubtasksAction`;
Esc → insert the text joined with spaces. Over 50 lines → toast "Up to 50 at a time."

Empty state: the add row plus a muted hint "Break this task into steps."

## 4. Opened subtask

- Under the header (modal and page), a banner: `↳ Subtask of <Parent title>` (link to parent)
  and `‹ 2 of 5 ›` sibling buttons from `siblings`. Replaces the small chevron breadcrumb in
  the modal header; page mode keeps its breadcrumb and adds the banner.
- Navigation keeps the existing contract: `?task=` in modal mode, `${tasksBase}/<id>` in page
  mode.
- New shortcuts in `src/lib/shortcuts/registry.ts`, scope `detail`, group Task:
  `detail.prevSibling` `[`, `detail.nextSibling` `]`, `detail.parent` `u`. Active only on a
  subtask; listed in the shortcuts sheet.

## 5. Board card

`src/components/board/TaskCard.tsx`:

- The card body is one big drag/open `<button>`, so nothing interactive can nest in it.
  `KanbanCard` gains a `footer` slot rendered after the button inside the card's `<li>`; when a
  footer is given, the card chrome (background, ring, shadow, radius) moves to a wrapper around
  button + footer. The footer holds a `2/5` toggle button (`aria-expanded`) with a small
  progress ring, replacing the in-body badge, and the checklist under it.
- Checklist shows up to 5 subtasks, then "+N more" which opens the parent. Each item: done
  toggle, truncated title (struck when done), assignee avatar if set. Title click opens the
  subtask via `?task=`.
- Expanded state is client memory keyed by task id (a small context in `Board.tsx`), collapsed
  by default, survives `router.refresh()`.
- Pointer and key events inside the checklist stop propagation so they neither open the
  parent nor start a card drag.

## 6. List

`src/components/task/TaskTable.tsx`:

- Parents with subtasks get a chevron button left of the title (`aria-expanded`); expanding
  inserts indented child rows (`↳`) with the full column set, row actions and bulk-select.
- Table settings menu: Expand all / Collapse all. Expanded ids kept in client state.
- Sorting applies to top-level rows; children stay under their parent in `subtaskPosition`
  order.
- Phone stacked rows (below `sm`) get the same chevron and indented child rows.
- Keyboard `j`/`k` row navigation walks visible child rows too.

## 7. Convert task ↔ subtask

- Top-level task ⋯ menu (detail header and list row actions): **Make subtask of…** opens a
  combobox of top-level tasks in the same project (via `searchTasksAction`, filtered to the
  project, excluding self). Disabled with tooltip "Tasks with subtasks can’t become subtasks."
  when it has subtasks.
- Subtask ⋯ menu (detail header and subtask row): **Promote to task**.
- After either, a toast with **Undo** that calls `setTaskParentAction` with the previous
  parent.

## 8. Testing

**Unit / integration (Vitest, DB):**
- `reorderSubtask`: middle, edges, non-sibling neighbour rejected, reversed neighbours stale,
  tied keys renumbered.
- `setTaskParent`: make subtask ok; cross-project, self, subtask-as-parent, has-children,
  archived parent rejected; promote resets keys and puts task at column end; no-op.
- Status change on a subtask leaves `subtaskPosition` unchanged.
- `createSubtasks`: order kept, 50 cap, blank lines dropped.
- Migration backfill keeps existing displayed order.
- Paste splitting helper.

**e2e (Playwright, targeted, on :3100):**
- Paste 3 lines → confirm → 3 subtasks in order.
- Inline rename; Escape reverts.
- Drag reorder persists after reload; toggling done keeps order.
- Change status / assignee / due from the row.
- Board: expand badge, tick a subtask, count updates.
- List: expand parent, child rows show.
- Make subtask of… then Undo; Promote to task.
- Opened subtask: banner, `]` goes to next sibling, `u` returns to parent.
