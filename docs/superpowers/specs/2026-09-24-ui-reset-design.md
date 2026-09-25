# UI Reset — Align UI + Kibo UI — Design Spec

**Date:** 2026-09-24
**Status:** Implemented on feat/ui-reset (Parts 1–4)
**Branch:** `feat/ui-reset` (from `master` at `9bcb2e8`)
**Scope:** Replace the shadcn/radix-nova UI layer with Align UI (base components) and
Kibo UI (Kanban, Editor, Theme Switcher, Relative Time). Behaviour stays the same except
where §5 lists a deliberate change.

## 1. Purpose

The current UI is shadcn's `radix-nova` style with lucide icons. The goal is a more polished,
consistent look by resetting the UI layer and rebuilding every screen on:

- **Align UI** — base controls (button, input, select, radio, checkbox, modal, dropdown,
  drawer, avatar, badge, tabs, tooltip, popover, command). Chosen for visual quality.
- **Kibo UI** — Kanban, Editor, Theme Switcher, Relative Time.
- **Tabler Icons** (`@tabler/icons-react`) — the only icon set, including inside copied Align
  and Kibo sources.

### Success criteria

- Every screen is rebuilt on Align tokens and components; no shadcn component or token remains.
- The existing e2e specs pass **unchanged** (the only addition is one Markdown step in
  `comments.spec.ts`, §6.5).
- The board supports pointer, keyboard and touch drag, with a live preview while dragging.
- Task descriptions and comments are edited with a rich editor and stored as Markdown in the
  existing text columns — no migration.

### Non-goals

New features beyond §5 and §6, schema changes, v2 roadmap items, Gantt/Calendar/List views,
replacing Sonner as the toast engine.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Remove `radix-ui` (umbrella), `lucide-react`, `shadcn`, `cn`, `class-variance-authority` from `package.json` (A1: `tw-animate-css` stays). Scoped `@radix-ui/react-*` packages may appear, **only** as dependencies of copied Align components. | Align copies source that imports Radix primitives directly; that is acceptable. The umbrella package and shadcn styling are what we remove. |
| D2 | Align theme: **Blue** primary, **Gray** neutral, oklch, Tailwind v4 CSS-first, Inter font (self-hosted, A5). | Align's default and most refined combination; calm, neutral fit for a task tool. |
| D3 | Tabler Icons everywhere. | User preference. Remix (Align's default) and lucide (Kibo's default) imports are rewritten. |
| D4 | Rich text stored as **Markdown** in existing `text` columns. | No migration; old plain-text rows are valid Markdown; human-readable; searchable. |
| D5 | Keep **Sonner** as the toast engine, restyled as an Align Notification. | 39 existing `toast()` call sites stay untouched; Sonner has no Radix dependency. |
| D6 | Kibo components are copied source, adapted to Align via a small token bridge (§3.3) rather than rewriting their classes. | Keeps the Kibo diff small and future updates portable. |
| D7 | Layered reset on one branch (§7), not a side-by-side migration. | Align's CLI overwrites `globals.css`; running two token systems in parallel costs more than one clean cut. |

## 3. Foundation

### 3.1 Removed

- `src/components/ui/*` (avatar, badge, button, dialog, dropdown-menu, input, label, select,
  sheet, sonner).
- `components.json` (radix-nova config).
- `@import "shadcn/tailwind.css"`, `@import "tw-animate-css"`, and every shadcn CSS variable in
  `src/app/globals.css` (`--background`, `--card`, `--muted`, `--primary`, `--sidebar-*`,
  `--chart-*`, `--radius-*`, …).
- Packages: see D1.

### 3.2 Added

- **Align tokens** from `npx @alignui/cli tailwind` (Blue / Gray / oklch) into a fresh
  `src/app/globals.css`. Dark mode via the `.dark` class, still toggled by `next-themes`.
- **Inter** via `next/font/google`, wired to Align's font variable.
- **Align utilities** under `src/utils/`: `cn.ts`, `tv.ts` (tailwind-variants),
  `recursive-clone-children.tsx`, `polymorphic.ts`, following Align's documented layout.
  Existing imports of `@/lib/utils` `cn` are repointed.
- `@tabler/icons-react`.

### 3.3 Kibo token bridge

Kibo sources use shadcn token names (`bg-background`, `bg-secondary`, `text-muted-foreground`,
`border`, `ring-primary`, `bg-card`, `bg-popover`, `bg-accent`). One clearly labelled `@theme`
block in `globals.css` maps each name Kibo actually uses onto an Align token, e.g.:

```css
/* Kibo bridge: shadcn token names used by src/components/kibo-ui/* → Align tokens. */
@theme inline {
  --color-background: var(--bg-white-0);
  --color-foreground: var(--text-strong-950);
  --color-muted-foreground: var(--text-sub-600);
  --color-border: var(--stroke-soft-200);
  --color-primary: var(--primary-base);
  /* …only names grep-confirmed in kibo-ui/ */
}
```

Only names grep-confirmed in `src/components/kibo-ui/` are bridged. App code (`board/`,
`task/`, `shell/`, `settings/`, `app/`) uses Align token classes directly and never the
bridged names; step 9 of §7 enforces this.

### 3.4 Directory layout

| Path | Contents |
|---|---|
| `src/components/ui/` | Align components (copied source, Tabler icons). |
| `src/components/kibo-ui/` | Kibo components (copied source, Tabler icons, Align primitives instead of shadcn). |
| `src/components/{board,task,shell,settings}/` | App components, rebuilt. |
| `src/utils/` | Align utilities. |

## 4. Component mapping

| Today | Align replacement | Used in |
|---|---|---|
| `Button` | Button (primary/neutral/error × filled/stroke/lighter/ghost); Compact Button for icon-only | 7 files |
| `Input` + `Label` | Input (Root/Wrapper/Icon) + Label | auth, forms, QuickAddTask, SubtaskSection |
| `Select` | Select | TaskDetailDialog (status, priority, assignee), TimezoneForm, MemberTable (per-row role), ManageColumnsDialog ("Move tasks to") |
| `Dialog` | Modal | TaskDetailDialog, NewProjectDialog, ManageColumnsDialog |
| `DropdownMenu` | Dropdown | WorkspaceSwitcher, LabelPicker |
| `Sheet` | Drawer | Rail (mobile) |
| `sonner` wrapper | Sonner with an Align Notification-styled toast (D5) | global |
| raw `<textarea>` ×3 | Kibo Editor (§6) | description, comment new, comment edit |
| done toggles (`<button aria-pressed>`) | Stay buttons, restyled with Tabler circle icons and Align tokens (A2) | TaskRow, SubtaskSection |
| label chips, `PriorityDot`, `DueChip` | Badge / Status Badge | TaskRow, TaskCard |
| member initials | Avatar | MemberTable, assignee display |
| InviteForm role `Select` (Member / Admin) | Radio group, labelled `Role` | InviteForm |
| due date `<input type="date">` | Align Input wrapping the native date input (no date-picker library) | TaskDetailDialog (`Due date`) |
| "completes tasks" toggle | Switch, keeping `aria-label="<status> completes tasks"` | ManageColumnsDialog |
| `ViewTabs` | Tab Menu (horizontal), keeping `role="tab"` | ProjectHeader |
| `ThemeToggle` | Kibo Theme Switcher (§5.3) | Rail |

### 4.1 Accessibility contract

Every rebuilt component keeps its current accessible name and role. Names the e2e suite
depends on include: labels `Title`, `Priority`, `Comment`, `Name`, `Email`, `Password`,
`Workspace name`, `Project name`, `Status`, `Assignee`, `Due date`, `Role`; roles `region "<status name>"`, `option "High"`,
`tab "Board"`, `dialog`; buttons `Create account`, `Create workspace`, `New project`,
`Create project`, `Comment`, `Mark "<title>" as done`, and the card button named by the task
title; placeholders `Add a task…`, `Add a subtask…`, `Add to <status>…`. The e2e specs are the
gate — they are not edited to accommodate the rebuild (§1).

## 5. Kibo components

### 5.1 Kanban

Kibo's Kanban (`KanbanProvider`, `KanbanBoard`, `KanbanHeader`, `KanbanCards`, `KanbanCard`)
is a thin layer over dnd-kit, which we already use. The copy in `src/components/kibo-ui/kanban/`
is adapted:

| Kibo as shipped | Adaptation |
|---|---|
| `MouseSensor` without activation constraint; `KeyboardSensor` without sortable coordinates | Board passes its own `sensors` (Kibo spreads `...props` onto `DndContext`): `MouseSensor` with `distance: 8`, `TouchSensor` with `delay: 250, tolerance: 5`, and `KeyboardSensor` with `sortableKeyboardCoordinates` (Space lifts and drops, Escape cancels; Enter is left to open the task). Mouse + Touch rather than `PointerSensor`, which also answers touch and would start a drag on every swipe. |
| `closestCenter` collision | Board passes its existing custom `collisionDetection` (pointer hits only when there is a pointer, so a release off the board saves nothing; rect → closest corners for the keyboard; a column hit maps to the nearest card in it, or to the column itself — "end of column" — when the pointer is below its last card), still keyed on the `status:` prefix (A3), plus `measuring: { droppable: { strategy: Always } }` and `id="project-board"`. |
| `handleDragOver` mutates the item in place (`newData[i].column = …`) | Clone the item before changing `column`. |
| Cards wrapped in shadcn `Card`; lists in shadcn `ScrollArea` (Radix) | Align-styled `div`; native `overflow-y-auto`. |
| `KanbanBoard` is an unlabelled `div` | Accepts `as="section"` and `aria-label` so columns stay `region "<status name>"`. |
| Custom announcements print column **id** | Removed, so dnd-kit's default announcements apply (A3); Board keeps its own `Moved to <name>, position n of m.` `aria-live` region. |
| `grid auto-cols-fr` | Fixed 280px columns; horizontal scroll only on the board container. |
| `tunnel-rat` + `DragOverlay` portal | Kept. |

**Deliberate behaviour changes:**
1. **Live preview** — while dragging, the card moves into the hovered column and a floating
   ghost (`DragOverlay`) follows the pointer. Today the card only moves on drop.
2. **Touch drag** on phones and tablets.

**Unchanged:** optimistic move via `useOptimistic`; server call with neighbour ids
(`beforeId`/`afterId`) only, never a position; failure → `toast.error` with Retry, then
`router.refresh()`; empty column shows "Drop a task here"; QuickAddTask in each column footer;
clicking a card opens the task detail via `?task=<id>`.

**Data flow:** server `tasks` → `useOptimistic` → `KanbanProvider` gets
`data = dragItems ?? optimisticItems`. `dragItems` is a working copy that exists only while a
drag is in progress: `onDataChange` sets it during the drag, and only drop (`onDragEnd`) and
cancel (`onDragCancel`, Esc) clear it — never an async callback, which could land in the middle
of the next drag. Outside a drag the board renders the optimistic list directly, so nothing has
to be re-synced. `onDragEnd` reads the card's final column and index from the final data,
derives neighbours with a pure helper, and — unless the drop was off the board or left the card
between the same neighbours — applies the optimistic move, calls `moveTaskAction`, refreshes.

**Neighbour helper:** `neighboursAfterMove(data, taskId) → { statusId, beforeId, afterId, index }`
in `src/components/board/neighbours.ts`, unit-tested (§8).

### 5.2 Relative Time

Kibo's Relative Time is a **live timezone clock** (ticks each second), not "n minutes ago".
It is used in **Settings → General** under the timezone select as a preview:

> Workspace time: 14:32 · Europe/Berlin
> Your time: 16:32 · Asia/Yerevan

- The workspace row follows the select's current (unsaved) value.
- The "your time" row uses `Intl.DateTimeFormat().resolvedOptions().timeZone` and is omitted
  when it equals the workspace zone.
- Rendered only after mount (clock plus browser zone would otherwise break hydration).
- Feed timestamps keep using `src/lib/dates.ts`.

### 5.3 Theme Switcher

Kibo's System / Light / Dark segmented control, driven by `next-themes`
(`value={theme}`, `onChange={setTheme}`), replaces `ThemeToggle`. Adaptations: lucide
`Monitor`/`Sun`/`Moon` → Tabler `IconDeviceDesktop`/`IconSun`/`IconMoon`; wrapper gets
`role="radiogroup"` + `aria-label="Theme"`, each button `role="radio"` + `aria-checked`; the
existing mount guard stays. Adds the `motion` dependency (animated pill).

## 6. Editor and Markdown

### 6.1 Editor

Kibo's Editor (Tiptap v3) is copied to `src/components/kibo-ui/editor/` and trimmed.

- **Kept extensions:** paragraph, heading 1–3, bold, italic, strike, inline code, link, bullet
  list, ordered list, task list, blockquote, code block (plain), placeholder.
- **Removed:** tables, subscript, superscript, text style/colour, lowlight syntax highlighting,
  character count. Drops `lowlight`, `fuse.js`, `@tiptap/extension-table`,
  `@tiptap/extension-text-style`, `@tiptap/extension-subscript`,
  `@tiptap/extension-superscript`, `@tiptap/extension-code-block-lowlight`.
- **Slash menu:** kept, with a plain case-insensitive `includes` filter over its ~8 items
  instead of Fuse. `tippy.js` and `@floating-ui/dom` stay.
- **Bubble menu:** bold/italic/strike/code/link.
- **shadcn → Align:** Button, Command, Dropdown, Popover, Separator, Tooltip.
- **Markdown:** `@tiptap/markdown`; content loads with `contentType: 'markdown'` and saves via
  `editor.getMarkdown()`.

### 6.2 Where it is used

| Place | Accessible name | Save behaviour (unchanged) |
|---|---|---|
| Task description | `Description` | On blur, when the Markdown differs from the stored value. |
| New comment | `Comment` | `Comment` button submits; editor clears on success. |
| Edit comment | `Edit comment` | Save / Cancel buttons, as today. |

The accessible name is set with `aria-label` on the contenteditable element, so
`getByLabel('Comment')` and Playwright's `fill()` keep working.

### 6.3 Read-only rendering

`react-markdown` + `remark-gfm` + `remark-breaks`, **without** `rehype-raw`, in a shared
`<Markdown>` component (`src/components/task/Markdown.tsx`):

- Raw HTML is never rendered, so it is XSS-safe; `react-markdown`'s default URL transform
  neutralises `javascript:` links.
- Links render with `target="_blank" rel="noopener noreferrer"`.
- `remark-breaks` keeps single line breaks from existing plain-text rows looking as they do now.
- Styles live in a `.md-content` class built on Align tokens.

### 6.4 Existing data

No migration. Existing plain-text descriptions and comments render as Markdown paragraphs;
`remark-breaks` preserves their line breaks.

### 6.5 Tests

- Unit: Markdown round-trip (load → `getMarkdown()`) for every kept node type; `<Markdown>`
  renders `<script>` as text and a `javascript:` link as inert.
- e2e: one new step in `comments.spec.ts` — post `**bold**`, expect a `<strong>` in the feed.

## 7. Implementation order

Each step is one or more commits; `yarn typecheck && yarn lint && yarn test` pass at every
commit; `yarn e2e` passes at the end of every step from 4 onwards.

1. **Foundation** (§3): removals, Align CLI tokens, Inter, utilities, Tabler, Kibo bridge.
   Temporarily broken app imports are stubbed so the build compiles.
2. **Align primitives** (§4) into `src/components/ui/`, icons rewritten to Tabler.
3. **Auth screens:** sign-in, sign-up, invite.
4. **Shell:** Rail (+ Drawer), WorkspaceSwitcher, ProjectHeader, ViewTabs, NewProjectDialog,
   Theme Switcher (§5.3).
5. **Settings:** TimezoneForm + Relative Time preview (§5.2), MemberTable, InviteForm.
6. **Task list and detail:** TaskList, TaskRow, QuickAddTask, TaskDetailDialog → Modal,
   LabelPicker, SubtaskSection, PriorityDot/DueChip → Badge.
7. **Editor** (§6): description, comments, `<Markdown>`.
8. **Kanban** (§5.1): Board, BoardColumn, TaskCard, ManageColumnsDialog.
9. **Cleanup:** grep gates (§9), remove unused bridge names, verify no unused dependencies.

## 8. Testing and verification

- **Unit:** `neighboursAfterMove` (same column up/down, cross column to top/middle/end, empty
  target column, drop on self); Markdown round-trip and sanitisation (§6.5).
- **e2e:** `auth.spec.ts`, `board.spec.ts`, `comments.spec.ts` pass unchanged apart from the
  §6.5 addition. `board.spec.ts` covers pointer drag, keyboard-only drag and click-to-open.
- **Visual:** after steps 3–8, Playwright screenshots of the affected screens at 1280px and
  390px, light and dark, reviewed against Align's reference look.

## 9. Definition of done

- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn e2e` all pass.
- `package.json` contains none of: `radix-ui`, `lucide-react`, `shadcn`, `tw-animate-css`, `cn`.
  Any `@radix-ui/react-*` present is imported by a file in `src/components/ui/`.
- `grep -rE "lucide-react|@remixicon|from 'radix-ui'" src` returns nothing.
- App code (outside the vendored `src/components/ui/` and `src/components/kibo-ui/`) uses no
  bridged shadcn token names and no hex colours; vendored files may keep upstream's literal SVG
  fills.
- Keyboard operation of the board and of every modal, dropdown and select works (e2e plus a
  manual pass).

## 10. Amendments from planning (2026-09-24)

Found while reading the pinned Align and Kibo sources and the e2e specs; these override the
sections above where they conflict.

- **A1 — `tw-animate-css` stays.** Align's Modal, Drawer, Dropdown, Select and Tooltip animate
  with `animate-in` / `fade-in-0` / `zoom-in-95` / `slide-in-from-*` classes, which in Tailwind
  v4 come from `tw-animate-css`. It has no Radix or shadcn dependency.
- **A2 — Done toggles are not checkboxes.** `tests/e2e` locate them as
  `getByRole('button', { name: 'Mark "<title>" as done' })`; Align's Checkbox is
  `role="checkbox"`. They stay `<button aria-pressed>` and are only restyled.
- **A3 — dnd-kit ids and announcements are part of the contract.** `board.spec.ts` waits on
  dnd-kit's default live region (`[id^="DndLiveRegion"]`) for "Draggable item",
  "droppable area status:" and "was dropped". Column droppable ids keep the `status:` prefix,
  and Kibo's custom announcements are removed so dnd-kit's defaults apply.
- **A4 — Kibo Kanban fixes beyond §5.1.** `handleDragEnd` calls `onDragEnd` *before* its own
  final reorder, so our copy computes the final data first and passes it as a second
  argument: `onDragEnd(event, finalData)`. A drop on a column container (`overIndex === -1`)
  appends instead of `arrayMove(…, -1)`. `handleDragOver`'s fallback to `columns[0]` when the
  target is neither card nor column is removed. `onDragCancel` clears the overlay card. The
  overlay portal renders only after mount (hydration). Cards render as `<li><button>` so the
  card keeps its native button semantics.
- **A5 — Inter is self-hosted** (`src/app/fonts/InterVariable.woff2` via `next/font/local`),
  matching the v1 decision to self-host fonts; no build-time network fetch.
- **A6 — Staged removal instead of one cut (§7 step 1).** So that every plan part leaves a
  working app, the shadcn components move to a temporary `src/components/legacy-ui/`, and the
  Kibo bridge also maps the legacy token names until the last screen is rebuilt. `radix-ui`,
  `lucide-react`, `cn`, `class-variance-authority`, `shadcn`, `components.json`,
  `shadcn/tailwind.css` and `legacy-ui/` are all deleted in Part 4's cleanup task. The
  definition of done (§9) is unchanged.
- **A7 — Align CLI is run in a throwaway directory.** `@alignui/cli@0.0.19 tailwind` is
  interactive, requires a `tailwind.config` file, and installs `tailwindcss@latest`. It is run
  once in a temp project; its CSS is post-processed (the `@media (prefers-color-scheme: dark)`
  block is removed so `next-themes` alone controls dark mode) and committed as
  `src/styles/align-tokens.css`.
- **A8 — Tailwind v4 fixes in vendored Align source.** The v3 arbitrary-variable shorthand
  `-[--x]` becomes `-(--x)`; Remix icons become Tabler (`RiArrowDownSLine→IconChevronDown`,
  `RiArrowRightSLine→IconChevronRight`, `RiCheckLine→IconCheck`, `RiCloseLine→IconX`,
  `RemixiconComponentType→TablerIcon`); Drawer gains a `side` prop (the rail opens from the
  left); files that import Radix get `'use client'`.

