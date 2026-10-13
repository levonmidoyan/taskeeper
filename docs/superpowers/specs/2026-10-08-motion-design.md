# Motion — design

Adds deliberate motion across the app: a springy, physical kanban drag, a task modal that
grows out of its card, smooth teammate (live refresh) changes, and calm list, checkbox and
view-switch transitions. Native-first: no animation library.

## Goal

The app feels smooth and connected without feeling slow. Things that move on screen show
where they came from and where they went.

Success:

- Dragging a board card feels physical: it lifts on pickup, a slot shows where it will land,
  and it settles into place on drop.
- Opening a task from the board or list morphs the card into the modal; closing shrinks it
  back. The close animation is no longer cut off.
- A teammate's move, add or delete (live refresh) slides, grows or fades instead of popping.
- To-do and notification items enter and leave smoothly; checking a box feels finished.
- Switching Summary / Board / List / Calendar crossfades the content only.
- `prefers-reduced-motion: reduce` removes all sliding, scaling and tilting (fades only, or
  instant).
- Browsers without View Transitions behave exactly as today.

## Decisions (user, 2026-10-08)

- **Feel:** mixed. Springy and visible on drag (and the modal morph); subtle and fast
  (Linear-style) everywhere else.
- **Scope:** full set (kanban drag, modal, remote moves, lists, checkbox, view switch, shared
  timing).
- **Approach:** native-first. dnd-kit config + CSS for drag; React `<ViewTransition>` (ships
  with Next 16.3 / React 19.3, see `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`)
  for navigation- and transition-driven motion; CSS `linear()` easing for springs. No
  `motion`/Framer Motion. If one spot proves unworkable natively, upgrade only that spot.

## Key constraint: local vs remote transitions

The board drop handler (`src/components/board/Board.tsx`) runs its optimistic move inside
`startTransition`, and live refresh calls `router.refresh()`, which is also a transition. A
card `<ViewTransition>` reacting to every transition would animate the user's own drops and
fight dnd-kit's drop animation.

Rule: card and row `<ViewTransition>`s animate position changes only for the
`remote-refresh` transition type, set via `addTransitionType` in LiveRefresh. Every other
transition type (local drops, optimistic updates) maps to `none` for those updates. Live
refresh is already deferred while the user drags (`isBusy`), so remote animations never
overlap a drag.

## 1. Foundations

**Motion tokens** in `src/app/globals.css` `@theme`:

| Token | Value | Use |
|---|---|---|
| `--ease-out-soft` | decelerate curve (≈ `cubic-bezier(0.22, 1, 0.36, 1)`) | subtle UI |
| `--ease-spring` | `linear()` curve, ~4% overshoot | drag, modal morph only |
| `--duration-fast` | 120 ms | hover, press, column highlight |
| `--duration-base` | 180 ms | popovers, fades, neighbour shift, crossfades |
| `--duration-slow` | 280 ms | modal morph, drop settle |

**Reduced motion:** extend the existing `@media (prefers-reduced-motion: reduce)` block in
`globals.css` to also neutralise `::view-transition-group(*)`, `::view-transition-old(*)`
and `::view-transition-new(*)` movement (crossfade or none) and the drag lift tilt/scale.

**Transition-type helper:** `src/lib/motion.ts` exports the type name
(`REMOTE_REFRESH = 'remote-refresh'`) and a helper that runs
`startTransition(() => { addTransitionType(REMOTE_REFRESH); router.refresh(); })`.
`src/components/shell/LiveRefresh.tsx` uses it for its refresh callback. Other
`router.refresh()` callers are unchanged.

**Shared timing:** retune the existing `tw-animate-css` durations and easings in
`ui/modal.tsx`, `ui/drawer.tsx`, `ui/popover.tsx`, `ui/dropdown.tsx`, `ui/tooltip.tsx` and
`ui/toaster.tsx` to the tokens. No new animations there, just consistent timing.

## 2. Kanban drag (springy)

All in `src/components/kibo-ui/kanban/index.tsx`, so the board gets it; other dnd-kit users
(ManageColumnsDialog, TodoList) can opt in.

1. **Lift on pickup.** The `DragOverlay` content animates in with `--ease-spring` over
   `--duration-base`: scale 1 → 1.03, rotate 0 → 2°, shadow `regular-xs` → `regular-md` (Align has no `regular-lg`).
   Done with a CSS keyframe on an inner wrapper so it never touches dnd-kit's transform.
2. **Ghost slot.** The in-place card while dragging (`isDragging`) renders as an empty slot
   of the same height: dashed `stroke-soft-200` border, faint primary tint, content hidden
   (`invisible`, keeps height). Replaces today's `opacity-30` copy.
3. **Drop settle.** Custom `dropAnimation` on `DragOverlay`: `--duration-slow`,
   `--ease-spring`; keyframes take the overlay from its lifted state (scale 1.03, 2°) to the
   slot (scale 1, 0°) while the shadow eases down. The slot shows the real card again only
   after the drop animation ends (no flash).
4. **Column highlight.** The existing `isOver` ring gains a background tint; both fade over
   `--duration-fast` instead of snapping.
5. **Neighbour shift.** `useSortable({ transition: { duration: 180, easing: <ease-out-soft> } })`.
6. **Keyboard and reduced motion.** Keyboard drags (Space / arrows / Space / Escape) get the
   same visuals. Reduced motion: no tilt or scale; shadow change and ghost slot remain.

## 3. Task modal and remote moves

**Card → modal morph.** Opening a task is a `?task=` navigation (a transition).

- Board cards and list-view rows wrap in `<ViewTransition name={`task-${id}`}>`; the task
  modal shell (`src/components/task/TaskDetailDialog.tsx`) wraps in a `<ViewTransition>`
  with the same name.
- A name must be unique at any moment and the card stays mounted while the modal is open, so
  a card renders its `<ViewTransition>` **without** the name while `?task` equals its id. In
  the opening commit the name moves from card to modal, and the browser morphs the card's
  box into the modal's (`--duration-slow`, `--ease-spring`).
- Modal body content fades in ~60 ms after the morph starts, so text is not stretched.
- Closing (removing `?task`) reverses it: the modal shrinks back into the card. The old
  state is snapshotted before unmount, which fixes today's cut-off close.
- **No source element** (command palette, notification link, calendar, direct URL): the
  modal's `<ViewTransition>` enter/exit falls back to fade + scale from 96%.
- Closing with the browser's Back button carries no transition type, so it does not morph
  back; it closes instantly as today. Escape, the overlay and the close button morph.
- **Reduced motion** keeps the existing global rule in `globals.css` (every animation and
  transition ~0 ms), now extended to view-transition pseudo-elements: changes are instant.
- Radix zoom/fade keyframes are removed from the task modal only (other modals keep theirs,
  retuned to tokens) to avoid double animation.

**Remote moves.** The same card/row `<ViewTransition>`s set
`update={{ 'remote-refresh': 'card-move', default: 'none' }}` and matching `enter`/`exit`:

- A card a teammate moved slides to its new column or position.
- A new card fades and grows in; a deleted card fades and shrinks out.
- Local drops and optimistic updates (`default`) do nothing, so dnd-kit stays in control.

## 4. Lists, checkbox, view switch

**To-do list** (`src/components/todo/TodoList.tsx`, `TodoItem.tsx`). Mutations already run as
`useOptimistic` inside `startTransition`, so `<ViewTransition>` applies directly.

- Each item: `<ViewTransition name={`todo-${id}`}>`.
- Add: fade + 4 px slide down into place; following items shift smoothly.
- Delete: fade out, the gap closes.
- Reorder: the to-do list has no `DragOverlay` (the row itself moves), so the dragged row
  gets a lift (shadow + scale 1.01, **no tilt**) and neighbours use the section 2 shift
  timing. dnd-kit's own transition settles it on drop.
- "Show done" toggle: crossfade expand/collapse.

**Notification bell** (`src/components/shell/NotificationBell.tsx`). Dismiss and clear-all
switch from bare `setItems` to `startTransition`.

- Dismiss: item fades and collapses.
- Clear all: items fade out together, then the empty state fades in. (A per-item stagger
  needs per-name CSS; dropped as not worth it, 2026-10-08.)
- Unread badge: small spring scale pop when the count increases.

**List view** (`src/components/task/TaskTable.tsx`, `views/WorkspaceTaskTable.tsx`). Rows take
the section 3 remote-refresh `<ViewTransition>`. Local sort and filter stay instant on
purpose.

**Checkbox complete** (to-do items, subtasks):

- Check mark pops in: the filled check icon scales 0.5 → 1 and fades in with `--ease-spring`
  (180 ms), the empty circle fades out. (The Tabler filled icon has no stroke to draw.)
  Transitions, not keyframes, so items that load already done do not animate.
- Strike-through sweeps left to right (`background-size` on a line gradient, 220 ms), then
  the text dims. Unchecking reverses it.
- A completed to-do moving into "done" animates via its `<ViewTransition>`.

**View switch** (`src/components/shell/ViewTabs.tsx` links). Wrap the project view content
area (not the header/tabs) in a `<ViewTransition>` with a `--duration-base` crossfade. No
directional slide: tabs are peers.

## Out of scope

- Page-level route transitions (workspace/project switches).
- Skeleton → content (Suspense) reveals.
- Calendar view animations.
- Adding an animation library.

## Testing

- **Unit:** card drops its transition name when it is the active `?task`; LiveRefresh
  refresh callback sets the `remote-refresh` type; bell dismiss/clear and to-do mutations run
  inside transitions (existing behaviour tests keep passing).
- **E2E (Playwright):**
  - Board drag still works (existing suites); the overlay carries the lift class; no overlay
    remains after drop.
  - Open a task from the board: modal visible, URL has `?task`. Close: card visible, no
    leftover `::view-transition` elements, focus returns as today.
  - Run with `reducedMotion: 'reduce'`: interactions complete, no transforms on the overlay.
- **Manual:** feel of drag, morph and checkbox in Chromium, Safari and Firefox; remote moves
  checked with two browsers; an unsupported/older browser still opens and closes the modal
  instantly.

## Risks

- **`<ViewTransition>` across the Radix portal:** the modal shell lives in a portal. View
  transition names are document-wide, so this should work; verify early in the plan (first
  task) and fall back to fade + scale if it does not.
- **`addTransitionType` availability:** confirm it is exported by the React build Next
  bundles before relying on it; if not, gate remote animations with a module-level flag set
  around the refresh.
- **Name collisions:** a task visible twice on one page (e.g. board plus another surface)
  would duplicate `task-${id}`. Only board cards and list rows get names, and these never
  render together.

## What shipped differently (2026-10-08)

Two React rules shaped most of these. A `<ViewTransition>` plays `enter` / `exit` only
when it sits above every DOM node in the subtree React inserts or removes; a boundary
nested inside a newly inserted element does nothing. And such a top-level boundary starts
a view transition whenever it mounts in a transition, animated or not.

- **Radix portal (§3 morph):** Radix `Portal` mounts its content one commit late, outside
  the opening transition, so no pair formed. `Modal.Content` takes an optional portal
  `container`; `TaskDetailDialog` passes `document.body` once hydrated. The morph works in
  both directions; the fade + scale fallback was not needed.
- **Remote changes (§3):** a boundary that can `enter` starts a view transition every
  time it mounts, even when all its classes resolve to `none`. React then holds every
  commit until the snapshot is taken, 100–250 ms, so typing during it is lost (it broke
  "Create another"). So no card or row boundary sits above its `<li>` / `<tr>`:
  - A teammate's move still slides: the named card boundary wraps the whole button inside
    the `<li>` and pairs across columns, gated by the `remote-refresh` type.
  - A teammate's new card grows in with a CSS keyframe. At mount, the card checks a module
    flag (`src/lib/live/remote-refresh.ts`, set by LiveRefresh around the refresh) and
    that the board has never shown its id (a moved card remounts too).
  - A teammate's delete is instant, and list rows do not animate remote changes.
  - `::view-transition-group(root)` gets `animation: none`, so the transitions that are
    meant to run (modal, to-dos, bell, view switch) hold commits for one frame instead
    of 250 ms.
- **To-dos (§4):** `useOptimistic` commits urgently, outside any view transition, so the
  list keeps its pending changes in plain state set inside the `todo-change` transition.
  The server action starts a task later, so it does not share (and hold) that transition's
  lane. The very first to-do swaps the empty state for a new list, so it
  appears without the grow-in; later adds animate. Quick-add needed no fallback: the type
  survives the action's revalidation.
- **View switch (§4):** one boundary in `projects/[projectId]/layout.tsx` around the page,
  not one per page (each page's content sits inside its own newly inserted `<main>`).
  It then became a directional slide with the header held still as a named anchor and a
  gliding tab pill (3ec9e4f).
