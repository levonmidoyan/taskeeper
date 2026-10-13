# Keyboard shortcuts (Jira-style) — design

Date: 2026-10-08
Status: approved in chat, awaiting spec review

## Goal

Let people drive tasks from the keyboard the way Jira allows: move through
tasks, open them, step between them, change fields, and jump between views,
with a `?` overlay that lists every shortcut.

## Current state

Single-key shortcuts are hand-rolled `window` `keydown` listeners that each
call `ignoreShortcut` from `src/components/shell/shortcuts.ts`:

| Key | Where | Does |
|---|---|---|
| `c` | `CreateTaskDialog` | open create-task dialog |
| `f` | `FilterBar` | open "+ Filter" |
| `/`, `Mod+K` | `CommandPalette` | open command palette |
| `Escape` | `TaskTable` | clear row selection |

`ignoreShortcut` rejects modified keys, already-handled events, typing
targets (inputs, textareas, selects, contentEditable) and any keystroke while
an overlay (`[role=dialog|menu|listbox]`) is open.

Task detail opens through the `?task=<id>` search param (dialog over the
view) or the full page `/[workspaceSlug]/tasks/[taskId]`.

## Approach

In-house registry plus one dispatcher (no new dependency). Every shortcut is
declared once in a static registry; components attach behaviour with a hook;
the help overlay renders from the same registry so it cannot drift.

## 1. Core — `src/lib/shortcuts/`

### `registry.ts`

```ts
type Scope = 'global' | 'nav' | 'detail';
type ShortcutDef = {
  id: string;            // 'nav.next', 'detail.assignToMe', 'goto.board'
  keys: string[];        // alternatives: ['j', 'ArrowDown'], ['g b'], ['Mod+k']
  scope: Scope;
  group: 'General' | 'Navigation' | 'Task' | 'Go to';
  label: string;         // shown in help overlay
};
export const SHORTCUTS: readonly ShortcutDef[];
```

Key syntax: a key is `KeyboardEvent.key` (case-sensitive for letters, so `?`
and `#` work as typed). `Mod+` means `Meta` on Mac, `Control` elsewhere. A
space separates the two steps of a chord (`g b`).

### `keys.ts`

Pure helpers: parse a key spec, match an event against a spec, format a spec
for display (`⌘K` / `Ctrl K`, `G then B`). Unit-tested.

### `ShortcutProvider` + `useShortcut(id, handler, { enabled })`

- Mounted once in the `(app)` shell layout. One `window` `keydown` listener.
- `useShortcut` registers a handler for a registry id while mounted (and
  `enabled`). Last mounted wins when two handlers bind the same id.
- Chord buffer: a lone `g` (passing the guards) starts a chord; the next key
  within 1000 ms completes it, otherwise the buffer clears. While a chord is
  pending the second key does not fall through to single-key shortcuts.
- Matched handler → `preventDefault()` and run.

### Scope resolution

Evaluated per keystroke:

1. Typing target, or `Alt`/`Ctrl`/`Meta` held (except declared `Mod+` keys),
   or `defaultPrevented` → nothing (unchanged from today).
2. An overlay is open that is **not** the task detail dialog (picker
   popover, menu, Select list, confirm, palette, help) → nothing. The
   overlay owns its keys, including Escape.
3. Task detail is open (dialog marked `data-shortcut-scope="detail"`, or the
   full task page root carries the same attribute) → `detail` and `global`
   shortcuts.
4. Otherwise → `nav` and `global` shortcuts.

`global` = `?`, `Mod+K`, go-to chords. `c`, `/` and `f` are `nav` scope, so
they stay off while a task is open.

A keyboard drag on the board (a card with `aria-pressed="true"`) also blocks
everything, so dnd-kit keeps the arrows.

`ignoreShortcut` and `OVERLAY_SELECTOR` move into `src/lib/shortcuts/` and
the existing `c`, `f`, `/`, `Escape` listeners migrate onto `useShortcut`.
`Mod+K` keeps the palette's own listener (it must also close the palette,
which is itself an overlay); the registry still lists it for the help
overlay. `shortcuts.ts` in shell is removed once nothing imports it.

## 2. Navigation (scope `nav`)

DOM-based cursor, uniform across views, no per-view state:

- The element that opens a task gets `data-task-nav="<taskId>"`: the board
  card button, the project List title button (`TaskTable`), the title link
  in the workspace Tasks list (`WorkspaceTaskTable`) and the row link on
  Recent. Board cards also get `data-nav-col="<statusId>"`.
- `j` / `ArrowDown`: focus next `[data-task-nav]` (board: next in same
  column). `k` / `ArrowUp`: previous.
- `h` / `ArrowLeft`, `l` / `ArrowRight` (board only): focus the card in the
  adjacent non-empty column whose vertical centre is closest to the current
  card's.
- Nothing focused yet → `j` / `k` (and `h` / `l`) focus the first task.
  Arrow keys act only when a task is already focused, so they still scroll
  the page otherwise.
- List view stops at page edges; no page change.
- `o`: open the focused task by clicking it, so each view opens it its own
  way (`?task=` dialog in project views, full page from workspace Tasks and
  Recent). `Enter` already does this natively on the focused button/link;
  help lists it next to `o`.
- `x` (project List only): toggle the focused row's selection checkbox.
- `Escape`: clear list selection (existing behaviour, migrated).
- Focus moves with `element.focus()` + `scrollIntoView({ block: 'nearest' })`;
  the visible ring comes from existing `:focus-visible` styles.

Views covered: project Board, project List, workspace Tasks (list layout),
Recent. Starred lists projects, not tasks, so it is not covered. To-do and
calendar views are out of scope.

## 3. Task detail (scope `detail`)

Applies to the detail dialog and the full task page.

| Key | Action |
|---|---|
| `j` / `k` | next / previous task in the underlying view (dialog only) |
| `e` | focus title input, text selected |
| `s` | open Status select |
| `p` | open Priority select |
| `a` | open Assignee picker |
| `i` | assign to me (no-op if already me) |
| `l` | open Label picker |
| `d` | open Due date field |
| `m` | focus comment composer (switches feed to Comments tab) |

- `j` / `k` read the `[data-task-nav]` items still rendered behind the
  dialog, find the current `?task=` id, and `router.replace` to the
  neighbour (same column on the board). At either end, or when the task is
  not in the view (a subtask, filtered out), nothing happens. Only the
  dialog binds them, so they are off on the full page route; the dialog only
  exists in project views (Board, List, Calendar — Calendar has no nav items
  so it is a no-op there).
- Closing the dialog (Escape or close) moves focus to the
  `[data-task-nav]` element of the task that was last shown, if present.
- Field triggers: Status and Priority `Select`s become controlled (`open`
  state); Assignee and Due date popover triggers are clicked by id; title,
  label input and comment composer are focused. No new UI. Every member can
  edit every field today, so there is no permission gate.

## 4. Go-to chords (scope `global`)

| Chord | Goes to |
|---|---|
| `g h` | workspace home |
| `g t` | to-do |
| `g c` | calendar (project calendar inside a project, else workspace) |
| `g b` / `g l` / `g s` | current project's Board / List / Summary (only inside a project) |

`router.push`. Project chords are not registered outside a project route.

## 5. Help overlay

- `?` opens a dialog listing shortcuts grouped by `group`, keys formatted
  per platform. Only registry data; no hand-written list.
- Command palette gets a "Keyboard shortcuts" command that opens it.
- The create button's title ("Create task (C)") and the search button's
  `⌘K` hint already show their keys. The "+ Filter" button gains
  `aria-keyshortcuts="f"` and a "(F)" title. No other new tooltips.

## 6. Testing

- Vitest unit: key-spec parsing/matching/formatting; chord buffer
  (complete, timeout, interrupted); scope resolution for each rule; DOM
  neighbour lookup (list order, board column + nearest-centre).
- One Playwright spec `tests/e2e/shortcuts.spec.ts`, run on its own (not the
  full e2e suite): board `j` + `Enter` opens task; detail `j` steps; `i`
  assigns to me; `g l` lands on List; `?` shows the overlay.
- Manual: Mac vs Linux key labels; typing in title / description / comment
  never triggers shortcuts; pickers keep their own keys.

## Out of scope

- User-customisable bindings.
- Shortcuts on board/list rows for field edits (actions are detail-only).
- To-do and calendar navigation.
- Visual "g…" pending-chord hint.
