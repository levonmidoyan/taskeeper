# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jira-style keyboard shortcuts: move through tasks on board/lists, open and step between tasks, change task fields from the keyboard, `g` chords to jump between views, and a `?` help overlay — all from one registry.

**Architecture:** A static registry (`src/lib/shortcuts/registry.ts`) declares every shortcut. One window `keydown` listener (a dispatcher created in `ShortcutProvider`) decides the active scope from the DOM (`none` / `nav` / `detail`), buffers `g` chords, and runs the handler a component bound with `useShortcut(id, handler)`. Task navigation is DOM-based: anything marked `data-task-nav="<id>"` is a stop; a pure function picks the neighbour.

**Tech Stack:** Next 16.3 (app router), React 19.3, TypeScript, Radix (Select/Popover/Dialog via Align `@/components/ui/*`), dnd-kit, Vitest (node env; `// @vitest-environment jsdom` per file for DOM), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-keyboard-shortcuts-design.md`

## Global Constraints

- No new dependencies.
- Single-key shortcuts never fire while typing (input, textarea, select, contentEditable), with Alt/Ctrl/Meta held, on an already-handled event, while any overlay other than the task detail dialog is open, or during a board keyboard drag.
- Scopes: `global` (`?`, `Mod+K`, go-to chords) work in `nav` and `detail`; `nav` keys only with no task open; `detail` keys only with the detail dialog or task page present.
- `Mod+` = Meta on Mac (`/Mac|iPhone|iPad/.test(navigator.platform)`), Control elsewhere. Displayed as `⌘` / `Ctrl`.
- Chord window: 1000 ms.
- Do NOT run the full e2e suite. Run only `yarn playwright test tests/e2e/shortcuts.spec.ts` (and any single spec named in a step).
- Commit messages: plain Conventional Commits, **no `Co-Authored-By` trailer** (user's global rule).
- Match surrounding code style: comments explain why, `cn()` from `@/utils/cn`, Align components from `@/components/ui/*`.

## Review Focus

1. Typing `j`, `e`, `#`, `?` in the title, description editor, comment composer or label input must type the character, not fire a shortcut — pinned by dispatcher guard tests (Task 2) and the e2e "typing in title" check (Task 7).
2. A picker opened by a shortcut (`s`, `a`) must own its keys: `j` inside the open Status list must not step to the next task — pinned by the dispatcher "foreign overlay blocks" test (Task 2) and e2e (Task 7).
3. Board keyboard drag (Space lift, arrows move) must not also move the nav cursor — pinned by the dispatcher "drag in progress" test (Task 2).
4. Arrow keys with nothing focused must still scroll the page (handler returns `false`, no `preventDefault`) — pinned by the TaskNavShortcuts unit test (Task 4).
5. Detail `j` on a task that is not in the view behind it (subtask, filtered out) must do nothing rather than jump to the first task — pinned by `navTarget` "unknown current" test (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/shortcuts/keys.ts` (new) | Parse / match / format key specs. Pure. |
| `src/lib/shortcuts/registry.ts` (new) | `SHORTCUTS` table + types. Pure data. |
| `src/lib/shortcuts/guards.ts` (new, moved) | `OVERLAY_SELECTOR`, `DETAIL_SELECTOR`, `isTypingTarget`, `activeScope`. |
| `src/lib/shortcuts/dispatcher.ts` (new) | `createDispatcher`: bind/handle, chord buffer. No React. |
| `src/lib/shortcuts/provider.tsx` (new) | `ShortcutProvider`, `useShortcut`, `useIsMac`. |
| `src/lib/shortcuts/nav.ts` (new) | `navTarget` (pure), `collectNavItems`, `focusedNavId`, `focusNavItem`. |
| `src/components/shell/TaskNavShortcuts.tsx` (new) | Binds `j k h l o` in nav scope. |
| `src/components/shell/GoToShortcuts.tsx` (new) | Binds `g …` chords. |
| `src/components/shell/ShortcutHelpDialog.tsx` (new) | `?` overlay rendered from registry. |
| `src/components/shell/shortcuts.ts` | Deleted (moved to `guards.ts`). |
| `src/components/shell/WorkspaceShell.tsx` | Wrap in `ShortcutProvider`. |
| `src/components/shell/AppHeader.tsx` | Mount nav/go-to/help; own help open state. |
| `src/components/shell/CommandPalette.tsx`, `palette-actions.ts` | `/` via registry; "Keyboard shortcuts" command; export `projectIdFromPath`. |
| `src/components/shell/CreateTaskDialog.tsx`, `src/components/filters/FilterBar.tsx` | Migrate `c`, `f`. |
| `src/components/kibo-ui/kanban/index.tsx`, `src/components/board/TaskCard.tsx` | `data-task-nav` / `data-nav-col` on card button. |
| `src/components/task/TaskTable.tsx` | `data-task-nav` on title button; `x`, `Escape` via registry. |
| `src/components/views/WorkspaceTaskTable.tsx`, `src/app/(app)/[workspaceSlug]/recent/page.tsx` | `data-task-nav` on links. |
| `src/components/task/TaskDetailDialog.tsx` | Detail scope marker, `j`/`k`, focus restore. |
| `src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx` | Detail scope marker on `<main>`. |
| `src/components/task/TaskDetailView.tsx` | `e s p a i l d #/Delete`. |
| `src/components/task/ActivityFeed.tsx` | `m`. |
| `src/components/task/LabelPicker.tsx` | `data-shortcut-target="labels"` on input. |
| `tests/unit/shortcut-keys.test.ts`, `shortcut-dispatcher.test.ts`, `shortcut-nav.test.ts`, `shortcut-registry.test.ts` (new) | Unit tests. |
| `tests/e2e/shortcuts.spec.ts` (new) | One targeted e2e. |

---

### Task 1: Key specs and registry

**Files:**
- Create: `src/lib/shortcuts/keys.ts`
- Create: `src/lib/shortcuts/registry.ts`
- Test: `tests/unit/shortcut-keys.test.ts`, `tests/unit/shortcut-registry.test.ts`

**Interfaces:**
- Produces:
  - `type KeyStep = { key: string; mod: boolean }`
  - `parseBinding(spec: string): KeyStep[]` — `'g b'` → 2 steps, `'Mod+k'` → `[{ key: 'k', mod: true }]`
  - `matchStep(step: KeyStep, e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, isMac: boolean): boolean`
  - `formatBinding(spec: string, isMac: boolean): string[][]` — one array of key labels per step, e.g. `'g b'` → `[['G'], ['B']]`, `'Mod+k'` (mac) → `[['⌘', 'K']]`
  - `type Scope = 'global' | 'nav' | 'detail'`; `type ShortcutGroup = 'General' | 'Navigation' | 'Task' | 'Go to'`
  - `type ShortcutDef = { id: ShortcutId; keys: string[]; scope: Scope; group: ShortcutGroup; label: string }`
  - `SHORTCUTS: readonly ShortcutDef[]`, `SHORTCUT_GROUPS: readonly ShortcutGroup[]`, `type ShortcutId` (union of ids below), `shortcutById(id: ShortcutId): ShortcutDef`

- [ ] **Step 1: Write the failing tests**

`tests/unit/shortcut-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBinding, matchStep, parseBinding } from '@/lib/shortcuts/keys';

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('parseBinding', () => {
  it('reads single keys, chords and Mod combos', () => {
    expect(parseBinding('j')).toEqual([{ key: 'j', mod: false }]);
    expect(parseBinding('g b')).toEqual([{ key: 'g', mod: false }, { key: 'b', mod: false }]);
    expect(parseBinding('Mod+k')).toEqual([{ key: 'k', mod: true }]);
    expect(parseBinding('ArrowDown')).toEqual([{ key: 'ArrowDown', mod: false }]);
    expect(parseBinding('?')).toEqual([{ key: '?', mod: false }]);
  });
});

describe('matchStep', () => {
  it('matches the exact key with no modifiers', () => {
    expect(matchStep({ key: 'j', mod: false }, ev('j'), false)).toBe(true);
    expect(matchStep({ key: 'j', mod: false }, ev('J'), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { ctrlKey: true }), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { altKey: true }), false)).toBe(false);
    expect(matchStep({ key: 'j', mod: false }, ev('j', { metaKey: true }), true)).toBe(false);
  });

  it('lets shifted symbols through (Shift is never checked)', () => {
    expect(matchStep({ key: '?', mod: false }, ev('?'), false)).toBe(true);
    expect(matchStep({ key: '#', mod: false }, ev('#'), false)).toBe(true);
  });

  it('reads Mod as Meta on Mac and Control elsewhere', () => {
    const modK = { key: 'k', mod: true };
    expect(matchStep(modK, ev('k', { metaKey: true }), true)).toBe(true);
    expect(matchStep(modK, ev('k', { ctrlKey: true }), true)).toBe(false);
    expect(matchStep(modK, ev('k', { ctrlKey: true }), false)).toBe(true);
    expect(matchStep(modK, ev('K', { ctrlKey: true }), false)).toBe(true);
    expect(matchStep(modK, ev('k'), false)).toBe(false);
  });

  it('ignores events with no key (autofill)', () => {
    expect(matchStep({ key: 'j', mod: false }, ev(undefined as unknown as string), false)).toBe(false);
  });
});

describe('formatBinding', () => {
  it('labels keys per platform', () => {
    expect(formatBinding('g b', false)).toEqual([['G'], ['B']]);
    expect(formatBinding('Mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatBinding('Mod+k', false)).toEqual([['Ctrl', 'K']]);
    expect(formatBinding('ArrowDown', false)).toEqual([['↓']]);
    expect(formatBinding('ArrowLeft', false)).toEqual([['←']]);
    expect(formatBinding('Escape', false)).toEqual([['Esc']]);
    expect(formatBinding('Delete', false)).toEqual([['Del']]);
    expect(formatBinding('?', false)).toEqual([['?']]);
  });
});
```

`tests/unit/shortcut-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseBinding } from '@/lib/shortcuts/keys';
import { SHORTCUT_GROUPS, SHORTCUTS } from '@/lib/shortcuts/registry';

describe('SHORTCUTS', () => {
  it('has unique ids and known groups', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORTCUTS.every((s) => SHORTCUT_GROUPS.includes(s.group))).toBe(true);
  });

  it('never binds the same key twice in scopes that are live together', () => {
    // nav and detail are never live at once; global is live with both.
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        for (const scope of s.scope === 'global' ? ['nav', 'detail'] : [s.scope]) {
          const slot = `${scope}:${k}`;
          expect(seen.get(slot), `${k} in ${scope}: ${s.id} vs ${seen.get(slot)}`).toBeUndefined();
          seen.set(slot, s.id);
        }
      }
    }
  });

  it('only starts chords with g, and g is never a single-key shortcut', () => {
    for (const s of SHORTCUTS) {
      for (const k of s.keys) {
        const steps = parseBinding(k);
        if (steps.length === 2) expect(steps[0].key).toBe('g');
        else expect(steps[0].key).not.toBe('g');
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/unit/shortcut-keys.test.ts tests/unit/shortcut-registry.test.ts`
Expected: FAIL — cannot resolve `@/lib/shortcuts/keys`.

- [ ] **Step 3: Implement `keys.ts`**

```ts
/** One keystroke of a shortcut. `mod` is Meta on Mac, Control elsewhere. */
export type KeyStep = { key: string; mod: boolean };

/** 'j', 'ArrowDown', '?', 'Mod+k', or a two-step chord 'g b'. */
export function parseBinding(spec: string): KeyStep[] {
  return spec.split(' ').map((part) =>
    part.startsWith('Mod+') ? { key: part.slice(4), mod: true } : { key: part, mod: false },
  );
}

/**
 * Shift is never checked, so '?' and '#' match as typed, while 'J' (Shift+j)
 * is simply a different key from 'j'.
 */
export function matchStep(
  step: KeyStep,
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>,
  isMac: boolean,
): boolean {
  // Autofill fires keydown events with no `key`.
  if (!e.key || e.altKey) return false;
  const modHeld = isMac ? e.metaKey : e.ctrlKey;
  const otherHeld = isMac ? e.ctrlKey : e.metaKey;
  if (otherHeld || modHeld !== step.mod) return false;
  return step.mod ? e.key.toLowerCase() === step.key : e.key === step.key;
}

const LABELS: Record<string, string> = {
  ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Delete: 'Del', Enter: 'Enter',
};

/** Key caps to draw, one array per step: 'Mod+k' → [['⌘', 'K']]. */
export function formatBinding(spec: string, isMac: boolean): string[][] {
  return parseBinding(spec).map(({ key, mod }) => {
    const cap = LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    return mod ? [isMac ? '⌘' : 'Ctrl', cap] : [cap];
  });
}
```

- [ ] **Step 4: Implement `registry.ts`**

```ts
export type Scope = 'global' | 'nav' | 'detail';
export type ShortcutGroup = 'General' | 'Navigation' | 'Task' | 'Go to';

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['General', 'Navigation', 'Task', 'Go to'];

/**
 * Every shortcut in the app, declared once. Components attach behaviour with
 * useShortcut(id, …); the help overlay renders this table, so the two cannot
 * drift. `nav` keys work with no task open, `detail` keys only with one open,
 * `global` keys in both.
 */
export const SHORTCUTS = [
  { id: 'general.help', keys: ['?'], scope: 'global', group: 'General', label: 'Show keyboard shortcuts' },
  { id: 'general.palette', keys: ['Mod+k'], scope: 'global', group: 'General', label: 'Search and commands' },
  { id: 'general.search', keys: ['/'], scope: 'nav', group: 'General', label: 'Search' },
  { id: 'general.create', keys: ['c'], scope: 'nav', group: 'General', label: 'Create task' },
  { id: 'general.filter', keys: ['f'], scope: 'nav', group: 'General', label: 'Add filter' },

  { id: 'nav.next', keys: ['j', 'ArrowDown'], scope: 'nav', group: 'Navigation', label: 'Next task' },
  { id: 'nav.prev', keys: ['k', 'ArrowUp'], scope: 'nav', group: 'Navigation', label: 'Previous task' },
  { id: 'nav.left', keys: ['h', 'ArrowLeft'], scope: 'nav', group: 'Navigation', label: 'Column to the left (board)' },
  { id: 'nav.right', keys: ['l', 'ArrowRight'], scope: 'nav', group: 'Navigation', label: 'Column to the right (board)' },
  { id: 'nav.open', keys: ['o'], scope: 'nav', group: 'Navigation', label: 'Open focused task (or Enter)' },
  { id: 'nav.select', keys: ['x'], scope: 'nav', group: 'Navigation', label: 'Select focused row (list)' },
  { id: 'nav.clear', keys: ['Escape'], scope: 'nav', group: 'Navigation', label: 'Clear selection (list)' },

  { id: 'detail.next', keys: ['j'], scope: 'detail', group: 'Task', label: 'Next task' },
  { id: 'detail.prev', keys: ['k'], scope: 'detail', group: 'Task', label: 'Previous task' },
  { id: 'detail.title', keys: ['e'], scope: 'detail', group: 'Task', label: 'Edit title' },
  { id: 'detail.status', keys: ['s'], scope: 'detail', group: 'Task', label: 'Change status' },
  { id: 'detail.priority', keys: ['p'], scope: 'detail', group: 'Task', label: 'Change priority' },
  { id: 'detail.assignee', keys: ['a'], scope: 'detail', group: 'Task', label: 'Assign' },
  { id: 'detail.assignMe', keys: ['i'], scope: 'detail', group: 'Task', label: 'Assign to me' },
  { id: 'detail.labels', keys: ['l'], scope: 'detail', group: 'Task', label: 'Add labels' },
  { id: 'detail.due', keys: ['d'], scope: 'detail', group: 'Task', label: 'Set due date' },
  { id: 'detail.comment', keys: ['m'], scope: 'detail', group: 'Task', label: 'Comment' },
  { id: 'detail.delete', keys: ['#', 'Delete'], scope: 'detail', group: 'Task', label: 'Delete task' },

  { id: 'goto.home', keys: ['g h'], scope: 'global', group: 'Go to', label: 'For you' },
  { id: 'goto.todo', keys: ['g t'], scope: 'global', group: 'Go to', label: 'My To-do' },
  { id: 'goto.calendar', keys: ['g c'], scope: 'global', group: 'Go to', label: 'Calendar (project’s, inside a project)' },
  { id: 'goto.board', keys: ['g b'], scope: 'global', group: 'Go to', label: 'Project board' },
  { id: 'goto.list', keys: ['g l'], scope: 'global', group: 'Go to', label: 'Project list' },
  { id: 'goto.summary', keys: ['g s'], scope: 'global', group: 'Go to', label: 'Project summary' },
] as const satisfies readonly {
  id: string; keys: readonly string[]; scope: Scope; group: ShortcutGroup; label: string;
}[];

export type ShortcutDef = (typeof SHORTCUTS)[number];
export type ShortcutId = ShortcutDef['id'];

export function shortcutById(id: ShortcutId): ShortcutDef {
  return SHORTCUTS.find((s) => s.id === id)!;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run tests/unit/shortcut-keys.test.ts tests/unit/shortcut-registry.test.ts`
Expected: PASS. (`SHORTCUT_GROUPS.includes(s.group)` may need `(SHORTCUT_GROUPS as readonly string[])` for TS; tests run regardless.) Then `yarn typecheck` — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shortcuts/keys.ts src/lib/shortcuts/registry.ts tests/unit/shortcut-keys.test.ts tests/unit/shortcut-registry.test.ts
git commit -m "feat(shortcuts): key specs and shortcut registry"
```

---

### Task 2: Guards, dispatcher, provider

**Files:**
- Create: `src/lib/shortcuts/guards.ts`
- Create: `src/lib/shortcuts/dispatcher.ts`
- Create: `src/lib/shortcuts/provider.tsx`
- Modify: `src/components/shell/WorkspaceShell.tsx`
- Test: `tests/unit/shortcut-dispatcher.test.ts`

**Interfaces:**
- Consumes: `parseBinding`, `matchStep` (Task 1); `SHORTCUTS`, `ShortcutId` (Task 1).
- Produces:
  - `guards.ts`: `OVERLAY_SELECTOR`, `DETAIL_SELECTOR = '[data-shortcut-scope="detail"]'`, `isTypingTarget(t: EventTarget | null): boolean`, `type ActiveScope = 'none' | 'nav' | 'detail'`, `activeScope(e: KeyboardEvent, doc?: Document): ActiveScope`
  - `dispatcher.ts`: `type ShortcutHandler = (e: KeyboardEvent) => void | false` (return `false` = not handled, no `preventDefault`); `createDispatcher(opts: { isMac: () => boolean; now?: () => number; chordMs?: number }): { bind(id: ShortcutId, handler: ShortcutHandler): () => void; handle(e: KeyboardEvent): void }`
  - `provider.tsx`: `ShortcutProvider({ children })`, `useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled?: boolean): void`, `useIsMac(): boolean`

- [ ] **Step 1: Write the failing test**

`tests/unit/shortcut-dispatcher.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDispatcher } from '@/lib/shortcuts/dispatcher';
import { activeScope } from '@/lib/shortcuts/guards';

let clock = 0;
const make = () => createDispatcher({ isMac: () => false, now: () => clock });

function press(d: ReturnType<typeof make>, key: string, init: KeyboardEventInit = {}, target: Element = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  d.handle(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = '';
  clock = 0;
});

describe('activeScope', () => {
  const key = (target: Element = document.body) => {
    const e = new KeyboardEvent('keydown', { key: 'j' });
    Object.defineProperty(e, 'target', { value: target });
    return e;
  };

  it('is nav with nothing open', () => {
    expect(activeScope(key())).toBe('nav');
  });

  it('is detail with the task dialog or task page present', () => {
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    expect(activeScope(key())).toBe('detail');
  });

  it('is none while typing', () => {
    document.body.innerHTML = '<input id="i"><textarea id="t"></textarea><div id="c" contenteditable="true"></div>';
    for (const id of ['i', 't']) expect(activeScope(key(document.getElementById(id)!))).toBe('none');
    const editable = document.getElementById('c')!;
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(activeScope(key(editable))).toBe('none');
  });

  it('is none when another overlay is open, even over the task dialog', () => {
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div><div role="listbox"></div>';
    expect(activeScope(key())).toBe('none');
    document.body.innerHTML = '<div role="menu"></div>';
    expect(activeScope(key())).toBe('none');
  });

  it('is none during a board keyboard drag', () => {
    document.body.innerHTML = '<button aria-roledescription="sortable" aria-pressed="true"></button>';
    expect(activeScope(key())).toBe('none');
  });
});

describe('dispatcher', () => {
  it('runs the bound handler in its scope and prevents default', () => {
    const d = make();
    const next = vi.fn();
    d.bind('nav.next', next);
    const e = press(d, 'j');
    expect(next).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it('matches every alternative key', () => {
    const d = make();
    const next = vi.fn();
    d.bind('nav.next', next);
    press(d, 'ArrowDown');
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips handlers outside the active scope', () => {
    const d = make();
    const navNext = vi.fn();
    const detailNext = vi.fn();
    d.bind('nav.next', navNext);
    d.bind('detail.next', detailNext);
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    press(d, 'j');
    expect(navNext).not.toHaveBeenCalled();
    expect(detailNext).toHaveBeenCalledOnce();
  });

  it('runs global shortcuts in both scopes', () => {
    const d = make();
    const help = vi.fn();
    d.bind('general.help', help);
    press(d, '?');
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"></div>';
    press(d, '?');
    expect(help).toHaveBeenCalledTimes(2);
  });

  it('leaves the event alone when the handler returns false', () => {
    const d = make();
    d.bind('nav.next', () => false);
    expect(press(d, 'ArrowDown').defaultPrevented).toBe(false);
  });

  it('ignores unbound shortcuts', () => {
    const d = make();
    expect(press(d, 'j').defaultPrevented).toBe(false);
  });

  it('lets the latest binding of an id win, and unbinding restores the previous', () => {
    const d = make();
    const first = vi.fn();
    const second = vi.fn();
    d.bind('nav.next', first);
    const unbind = d.bind('nav.next', second);
    press(d, 'j');
    expect(second).toHaveBeenCalledOnce();
    unbind();
    press(d, 'j');
    expect(first).toHaveBeenCalledOnce();
  });

  it('does nothing while typing or with a foreign overlay open', () => {
    const d = make();
    const next = vi.fn();
    d.bind('detail.next', next);
    document.body.innerHTML = '<div role="dialog" data-shortcut-scope="detail"><input id="title"></div>';
    press(d, 'j', {}, document.getElementById('title')!);
    document.body.insertAdjacentHTML('beforeend', '<div role="listbox"></div>');
    press(d, 'j');
    expect(next).not.toHaveBeenCalled();
  });

  describe('chords', () => {
    it('completes g then b within the window', () => {
      const d = make();
      const board = vi.fn();
      const left = vi.fn();
      d.bind('goto.board', board);
      d.bind('nav.left', left);
      expect(press(d, 'g').defaultPrevented).toBe(true);
      clock = 900;
      press(d, 'b');
      expect(board).toHaveBeenCalledOnce();
    });

    it('swallows the second key so it never falls through to a single-key shortcut', () => {
      const d = make();
      const list = vi.fn();
      const right = vi.fn();
      d.bind('goto.list', list);
      d.bind('nav.right', right);
      press(d, 'g');
      press(d, 'l');
      expect(list).toHaveBeenCalledOnce();
      expect(right).not.toHaveBeenCalled();
    });

    it('expires after the window; the late key then acts on its own', () => {
      const d = make();
      const list = vi.fn();
      const right = vi.fn();
      d.bind('goto.list', list);
      d.bind('nav.right', right);
      press(d, 'g');
      clock = 1001;
      press(d, 'l');
      expect(list).not.toHaveBeenCalled();
      expect(right).toHaveBeenCalledOnce();
    });

    it('drops a pending chord when the second key is unbound', () => {
      const d = make();
      const board = vi.fn();
      d.bind('goto.board', board);
      press(d, 'g');
      press(d, 'z');
      press(d, 'b');
      expect(board).not.toHaveBeenCalled();
    });

    it('does not start a chord when no chord is bound', () => {
      const d = make();
      expect(press(d, 'g').defaultPrevented).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/unit/shortcut-dispatcher.test.ts`
Expected: FAIL — cannot resolve `@/lib/shortcuts/dispatcher`.

- [ ] **Step 3: Implement `guards.ts`**

```ts
/** Anything open that owns the keyboard: a dialog, a menu, or a dropdown list such as a Select's. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"]';

/** The task detail dialog or task page: a dialog that still lets task shortcuts through. */
export const DETAIL_SELECTOR = '[data-shortcut-scope="detail"]';

/** A board card mid keyboard-drag: dnd-kit owns the arrows until it drops. */
const DRAGGING_SELECTOR = '[aria-roledescription="sortable"][aria-pressed="true"]';

export function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export type ActiveScope = 'none' | 'nav' | 'detail';

/**
 * Which shortcuts a keystroke may reach. Fields, handled events, drags and any
 * overlay other than the task detail (a picker, menu, confirm, the palette)
 * keep the keystroke; Alt/Ctrl/Meta are checked per key in matchStep.
 */
export function activeScope(e: KeyboardEvent, doc: Document = document): ActiveScope {
  if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target)) return 'none';
  if (doc.querySelector(DRAGGING_SELECTOR)) return 'none';
  for (const el of doc.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!el.matches(DETAIL_SELECTOR)) return 'none';
  }
  return doc.querySelector(DETAIL_SELECTOR) ? 'detail' : 'nav';
}
```

- [ ] **Step 4: Implement `dispatcher.ts`**

```ts
import { matchStep, parseBinding, type KeyStep } from '@/lib/shortcuts/keys';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/registry';
import { activeScope } from '@/lib/shortcuts/guards';

/** Return false to leave the keystroke alone (no preventDefault), e.g. an arrow with nothing focused. */
export type ShortcutHandler = (e: KeyboardEvent) => void | false;

const PARSED = SHORTCUTS.map((def) => ({ def, bindings: def.keys.map(parseBinding) }));

/**
 * One keydown handler for the whole app. Components bind handlers to registry
 * ids; the latest binding of an id wins, so a nested view can take a key over
 * and give it back on unmount.
 */
export function createDispatcher({
  isMac, now = () => Date.now(), chordMs = 1000,
}: { isMac: () => boolean; now?: () => number; chordMs?: number }) {
  const handlers = new Map<ShortcutId, ShortcutHandler[]>();
  let pending: { step: KeyStep; at: number } | null = null;

  function bind(id: ShortcutId, handler: ShortcutHandler) {
    const stack = handlers.get(id) ?? [];
    stack.push(handler);
    handlers.set(id, stack);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }

  function live(scope: 'nav' | 'detail') {
    return PARSED.filter(({ def }) =>
      (def.scope === 'global' || def.scope === scope) && (handlers.get(def.id)?.length ?? 0) > 0);
  }

  function run(id: ShortcutId, e: KeyboardEvent) {
    const stack = handlers.get(id)!;
    if (stack[stack.length - 1](e) !== false) e.preventDefault();
  }

  function handle(e: KeyboardEvent) {
    const scope = activeScope(e);
    if (scope === 'none') {
      pending = null;
      return;
    }
    const mac = isMac();
    const candidates = live(scope);

    if (pending) {
      const first = pending;
      pending = null;
      // The second key of a chord never falls through to a single-key shortcut.
      if (now() - first.at <= chordMs) {
        for (const { def, bindings } of candidates) {
          if (bindings.some((b) => b.length === 2 && b[0].key === first.step.key && matchStep(b[1], e, mac))) {
            run(def.id, e);
            return;
          }
        }
        return;
      }
    }

    for (const { bindings } of candidates) {
      const chord = bindings.find((b) => b.length === 2 && matchStep(b[0], e, mac));
      if (chord) {
        pending = { step: chord[0], at: now() };
        e.preventDefault();
        return;
      }
    }

    for (const { def, bindings } of candidates) {
      if (bindings.some((b) => b.length === 1 && matchStep(b[0], e, mac))) {
        run(def.id, e);
        return;
      }
    }
  }

  return { bind, handle };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run tests/unit/shortcut-dispatcher.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `provider.tsx`**

```tsx
'use client';

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createDispatcher, type ShortcutHandler } from '@/lib/shortcuts/dispatcher';
import type { ShortcutId } from '@/lib/shortcuts/registry';

const noSubscribe = () => () => {};

export function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** The platform never changes; false on the server so the first paint matches. */
export function useIsMac() {
  return useSyncExternalStore(noSubscribe, isMacPlatform, () => false);
}

type Dispatcher = ReturnType<typeof createDispatcher>;
const ShortcutContext = createContext<Dispatcher | null>(null);

/** Owns the app's one keydown listener; mounted once around the workspace shell. */
export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [dispatcher] = useState(() => createDispatcher({ isMac: isMacPlatform }));

  useEffect(() => {
    window.addEventListener('keydown', dispatcher.handle);
    return () => window.removeEventListener('keydown', dispatcher.handle);
  }, [dispatcher]);

  return <ShortcutContext.Provider value={dispatcher}>{children}</ShortcutContext.Provider>;
}

/**
 * Runs `handler` when the registry's `id` fires. The handler is read at
 * keypress time, so it may close over fresh state without rebinding.
 */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled = true) {
  const dispatcher = useContext(ShortcutContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!dispatcher || !enabled) return;
    return dispatcher.bind(id, (e) => latest.current(e));
  }, [dispatcher, id, enabled]);
}
```

- [ ] **Step 7: Mount in `WorkspaceShell.tsx`**

Add import `import { ShortcutProvider } from '@/lib/shortcuts/provider';` and wrap the returned tree:

```tsx
  return (
    <ShortcutProvider>
      <div className="flex min-h-dvh bg-bg-white-0">
        {/* …unchanged children… */}
      </div>
    </ShortcutProvider>
  );
```

- [ ] **Step 8: Verify**

Run: `yarn typecheck && yarn vitest run tests/unit/shortcut-dispatcher.test.ts`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/shortcuts tests/unit/shortcut-dispatcher.test.ts src/components/shell/WorkspaceShell.tsx
git commit -m "feat(shortcuts): scoped dispatcher with g chords and provider"
```

---

### Task 3: Migrate existing shortcuts (`c`, `f`, `/`, `Escape`)

**Files:**
- Modify: `src/components/shell/CreateTaskDialog.tsx:20,67-76`
- Modify: `src/components/filters/FilterBar.tsx:5,57-66,82-87`
- Modify: `src/components/shell/CommandPalette.tsx:10,57-75`
- Modify: `src/components/task/TaskTable.tsx:28,389-396`
- Delete: `src/components/shell/shortcuts.ts`

**Interfaces:**
- Consumes: `useShortcut` (Task 2), `OVERLAY_SELECTOR` from `@/lib/shortcuts/guards`, `useIsMac` from `@/lib/shortcuts/provider`.

- [ ] **Step 1: CreateTaskDialog** — replace the `useEffect` keydown block (lines 67–76) with:

```tsx
  useShortcut('general.create', () => onOpenChange(true), !disabled);
```

Replace the `ignoreShortcut` import with `import { useShortcut } from '@/lib/shortcuts/provider';` and drop `useEffect` from the React import if unused.

- [ ] **Step 2: FilterBar** — replace the `useEffect` (lines 57–66, including the `// F opens…` comment) with:

```tsx
  // F opens "+ Filter", like the other single-key shortcuts.
  useShortcut('general.filter', () => setAdding(true));
```

Swap the import for `useShortcut`. On the "+ Filter" `Button.Root` add `title="Add filter (F)"` and `aria-keyshortcuts="f"`.

- [ ] **Step 3: CommandPalette** — keep the ⌘K branch in its own listener (it must also close the palette, which is itself an overlay), drop the `/` branch, and bind `/` through the registry:

```tsx
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Autofill fires keydown events with no `key`.
      const modK = e.key?.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (!modK) return;
      // Another dialog, menu or dropdown owns the screen; leave it alone.
      if (!open && document.querySelector(OVERLAY_SELECTOR)) return;
      e.preventDefault();
      onOpenChange(!open);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useShortcut('general.search', () => setOpen(true), !open);
```

Imports: `import { OVERLAY_SELECTOR } from '@/lib/shortcuts/guards';`, `import { useIsMac, useShortcut } from '@/lib/shortcuts/provider';`. Replace the local `isMac` `useSyncExternalStore` line with `const isMac = useIsMac();` and remove `noSubscribe` / `useSyncExternalStore` if now unused.

- [ ] **Step 4: TaskTable** — replace the Escape `useEffect` (lines 389–396) with:

```tsx
  useShortcut('nav.clear', clearSelection, selectedIds.length > 0);
```

Swap the `ignoreShortcut` import for `useShortcut`.

- [ ] **Step 5: Delete the old module and check nothing imports it**

```bash
git rm src/components/shell/shortcuts.ts
grep -rn "shell/shortcuts" src tests || echo "no references"
```

Expected: `no references`.

- [ ] **Step 6: Verify**

Run: `yarn typecheck && yarn lint && yarn vitest run tests/unit`
Expected: PASS. (Unit tests that need the DB are under `tests/server`, not run here.)

Run the existing specs that exercise these keys, singly:
`yarn playwright test tests/e2e/search.spec.ts tests/e2e/create-task.spec.ts tests/e2e/list-bulk.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/components src/lib
git commit -m "refactor(shortcuts): move c, f, / and Escape onto the registry"
```

---

### Task 4: Task navigation (`j k h l o x`)

**Files:**
- Create: `src/lib/shortcuts/nav.ts`
- Create: `src/components/shell/TaskNavShortcuts.tsx`
- Modify: `src/components/kibo-ui/kanban/index.tsx:113-155` (KanbanCard props + button attrs)
- Modify: `src/components/board/TaskCard.tsx`
- Modify: `src/components/task/TaskTable.tsx` (title button ~line 583; `x` binding)
- Modify: `src/components/views/WorkspaceTaskTable.tsx:72`
- Modify: `src/app/(app)/[workspaceSlug]/recent/page.tsx:62`
- Modify: `src/components/shell/AppHeader.tsx`
- Test: `tests/unit/shortcut-nav.test.ts`

**Interfaces:**
- Consumes: `useShortcut` (Task 2).
- Produces (`nav.ts`):
  - `type NavItem = { id: string; col: string | null; top: number; bottom: number }`
  - `type NavDirection = 'next' | 'prev' | 'left' | 'right'`
  - `navTarget(items: NavItem[], currentId: string, dir: NavDirection): string | null` — `null` if `currentId` not in `items` or no neighbour
  - `collectNavItems(doc?: Document): NavItem[]` — DOM order, outside `[data-shortcut-scope="detail"]`
  - `focusedNavId(doc?: Document): string | null`
  - `focusNavItem(id: string, doc?: Document): boolean`
  - `NAV_ATTR = 'data-task-nav'`, `NAV_COL_ATTR = 'data-nav-col'`

- [ ] **Step 1: Write the failing test**

`tests/unit/shortcut-nav.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectNavItems, focusedNavId, focusNavItem, navTarget, type NavItem } from '@/lib/shortcuts/nav';

const item = (id: string, col: string | null, top: number, height = 40): NavItem => ({ id, col, top, bottom: top + height });

describe('navTarget — list (no columns)', () => {
  const rows = [item('a', null, 0), item('b', null, 50), item('c', null, 100)];

  it('steps forward and back in order', () => {
    expect(navTarget(rows, 'a', 'next')).toBe('b');
    expect(navTarget(rows, 'c', 'prev')).toBe('b');
  });

  it('stops at either end', () => {
    expect(navTarget(rows, 'c', 'next')).toBeNull();
    expect(navTarget(rows, 'a', 'prev')).toBeNull();
  });

  it('has no columns to the side', () => {
    expect(navTarget(rows, 'b', 'left')).toBeNull();
    expect(navTarget(rows, 'b', 'right')).toBeNull();
  });

  it('returns null for a task not in the view (subtask, filtered out)', () => {
    expect(navTarget(rows, 'zzz', 'next')).toBeNull();
  });
});

describe('navTarget — board', () => {
  // todo: a(0) b(50) c(100) | doing: (empty) | done: x(0) y(80)
  const board = [
    item('a', 'todo', 0), item('b', 'todo', 50), item('c', 'todo', 100),
    item('x', 'done', 0), item('y', 'done', 80),
  ];
  const withEmpty = [...board.slice(0, 3), ...board.slice(3)];

  it('moves within the column only', () => {
    expect(navTarget(board, 'c', 'next')).toBeNull();
    expect(navTarget(board, 'x', 'prev')).toBeNull();
    expect(navTarget(board, 'a', 'next')).toBe('b');
  });

  it('jumps to the nearest card by vertical centre in the next non-empty column', () => {
    expect(navTarget(withEmpty, 'c', 'right')).toBe('y');
    expect(navTarget(withEmpty, 'a', 'right')).toBe('x');
    expect(navTarget(withEmpty, 'y', 'left')).toBe('c');
  });

  it('stops at the outer columns', () => {
    expect(navTarget(board, 'a', 'left')).toBeNull();
    expect(navTarget(board, 'x', 'right')).toBeNull();
  });
});

describe('DOM helpers', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('collects stops in DOM order, skipping anything inside the task detail', () => {
    document.body.innerHTML = `
      <button data-task-nav="a" data-nav-col="todo"></button>
      <a href="#" data-task-nav="b"></a>
      <div data-shortcut-scope="detail"><button data-task-nav="sub"></button></div>`;
    expect(collectNavItems().map((i) => [i.id, i.col])).toEqual([['a', 'todo'], ['b', null]]);
  });

  it('reads and moves focus', () => {
    document.body.innerHTML = '<button data-task-nav="a"><span id="inner"></span></button><button data-task-nav="b"></button>';
    expect(focusedNavId()).toBeNull();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(focusNavItem('b')).toBe(true);
    expect(focusedNavId()).toBe('b');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(focusNavItem('missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/unit/shortcut-nav.test.ts`
Expected: FAIL — cannot resolve `@/lib/shortcuts/nav`.

- [ ] **Step 3: Implement `nav.ts`**

```ts
import { DETAIL_SELECTOR } from '@/lib/shortcuts/guards';

export const NAV_ATTR = 'data-task-nav';
export const NAV_COL_ATTR = 'data-nav-col';

/** A task the keyboard can land on; `col` is its board column, null in a list. */
export type NavItem = { id: string; col: string | null; top: number; bottom: number };
export type NavDirection = 'next' | 'prev' | 'left' | 'right';

const centre = (i: NavItem) => (i.top + i.bottom) / 2;

/**
 * The task the cursor moves to, or null to stay put. Up/down stays in the
 * current column (the whole list when there are none); left/right skips empty
 * columns and lands on the card level with the current one.
 */
export function navTarget(items: NavItem[], currentId: string, dir: NavDirection): string | null {
  const current = items.find((i) => i.id === currentId);
  if (!current) return null;

  if (dir === 'next' || dir === 'prev') {
    const peers = items.filter((i) => i.col === current.col);
    const at = peers.indexOf(current);
    return peers[dir === 'next' ? at + 1 : at - 1]?.id ?? null;
  }

  if (current.col === null) return null;
  const cols = [...new Set(items.map((i) => i.col).filter((c): c is string => c !== null))];
  const step = dir === 'right' ? 1 : -1;
  for (let c = cols.indexOf(current.col) + step; c >= 0 && c < cols.length; c += step) {
    const column = items.filter((i) => i.col === cols[c]);
    if (!column.length) continue;
    const y = centre(current);
    return column.reduce((best, i) => (Math.abs(centre(i) - y) < Math.abs(centre(best) - y) ? i : best)).id;
  }
  return null;
}

/** Every task stop on the page behind any open task, in DOM order. */
export function collectNavItems(doc: Document = document): NavItem[] {
  return [...doc.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)]
    .filter((el) => !el.closest(DETAIL_SELECTOR))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute(NAV_ATTR)!, col: el.getAttribute(NAV_COL_ATTR), top: r.top, bottom: r.bottom };
    });
}

export function focusedNavId(doc: Document = document): string | null {
  return doc.activeElement?.closest(`[${NAV_ATTR}]`)?.getAttribute(NAV_ATTR) ?? null;
}

function navElement(id: string, doc: Document) {
  return doc.querySelector<HTMLElement>(`[${NAV_ATTR}="${CSS.escape(id)}"]`);
}

/** Focuses a task's stop and scrolls it just into view. */
export function focusNavItem(id: string, doc: Document = document): boolean {
  const el = navElement(id, doc);
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

export function clickNavItem(id: string, doc: Document = document): boolean {
  const el = navElement(id, doc);
  el?.click();
  return el !== null;
}
```

(jsdom lacks `CSS.escape`? It has it since jsdom 20 — if the test errors with `CSS is not defined`, replace with `id.replace(/["\\]/g, '\\$&')`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/unit/shortcut-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Mark the stops**

`src/components/kibo-ui/kanban/index.tsx` — add to `KanbanCardProps`:

```ts
  /** Marks the card as a keyboard stop for task shortcuts (data-task-nav / data-nav-col). */
  navColumn?: string;
```

Destructure `navColumn` in `KanbanCard` and add to the `<button>`:

```tsx
      data-task-nav={navColumn !== undefined ? id : undefined}
      data-nav-col={navColumn}
```

`src/components/board/TaskCard.tsx` — pass `navColumn={task.statusId}` to `KanbanCard`.

`src/components/task/TaskTable.tsx` — on the title `<button>` (the one with `aria-label={row.original.title}`) add `data-task-nav={row.original.id}`.

`src/components/views/WorkspaceTaskTable.tsx:72` — on the title `<Link>` add `data-task-nav={t.id}`.

`src/app/(app)/[workspaceSlug]/recent/page.tsx:62` — on the row `<Link>` add `data-task-nav={task.id}`.

- [ ] **Step 6: Create `TaskNavShortcuts.tsx`**

```tsx
'use client';

import { useShortcut } from '@/lib/shortcuts/provider';
import {
  clickNavItem, collectNavItems, focusedNavId, focusNavItem, navTarget, type NavDirection,
} from '@/lib/shortcuts/nav';

/** Exported for the unit test; the component below is the only caller. */
export function moveNavCursor(dir: NavDirection, e: KeyboardEvent): void | false {
  const current = focusedNavId();
  // Arrows only steer once a task has focus, so they still scroll the page otherwise.
  if (!current && e.key.startsWith('Arrow')) return false;
  const items = collectNavItems();
  if (!items.length) return false;
  const target = current ? navTarget(items, current, dir) : items[0].id;
  if (target) focusNavItem(target);
}

/** j/k/h/l (and arrows) walk the task stops on the page; o opens the focused one. */
export function TaskNavShortcuts() {
  useShortcut('nav.next', (e) => moveNavCursor('next', e));
  useShortcut('nav.prev', (e) => moveNavCursor('prev', e));
  useShortcut('nav.left', (e) => moveNavCursor('left', e));
  useShortcut('nav.right', (e) => moveNavCursor('right', e));
  useShortcut('nav.open', () => {
    const id = focusedNavId();
    // A click, so each view opens the task its own way (dialog or full page).
    if (!id || !clickNavItem(id)) return false;
  });
  return null;
}
```

Render `<TaskNavShortcuts />` inside `AppHeader`'s `<header>` (next to `<CreateTaskDialog …/>`).

- [ ] **Step 7: `x` in TaskTable**

Below the `nav.clear` binding:

```tsx
  useShortcut('nav.select', () => {
    const id = focusedNavId();
    if (!id || !rows.some((r) => r.id === id)) return false;
    toggleRow(id, false);
  });
```

Import `focusedNavId` from `@/lib/shortcuts/nav`. (`rows` are the current page's rows; their `id` is the task id — confirm with `row.id` used in `selection.has(row.id)`.)

- [ ] **Step 8: Unit-test the arrow pass-through (Review Focus 4)**

Append to `tests/unit/shortcut-nav.test.ts`:

```ts
describe('arrow keys with nothing focused', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('leave the page to scroll; j still lands on the first task', async () => {
    const { createDispatcher } = await import('@/lib/shortcuts/dispatcher');
    const { moveNavCursor } = await import('@/components/shell/TaskNavShortcuts');
    document.body.innerHTML = '<button data-task-nav="a"></button><button data-task-nav="b"></button>';
    Element.prototype.scrollIntoView = () => {};
    const d = createDispatcher({ isMac: () => false });
    d.bind('nav.next', (e) => moveNavCursor('next', e));
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    d.handle(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(focusedNavId()).toBeNull();
    d.handle(new KeyboardEvent('keydown', { key: 'j', cancelable: true }));
    expect(focusedNavId()).toBe('a');
  });
});
```

Run: `yarn vitest run tests/unit/shortcut-nav.test.ts` — PASS.

- [ ] **Step 9: Verify**

Run: `yarn typecheck && yarn lint`
Run singly: `yarn playwright test tests/e2e/board.spec.ts tests/e2e/board-drag.spec.ts`
Expected: PASS (keyboard drag still works; the new attributes change nothing visible).

- [ ] **Step 10: Commit**

```bash
git add -A src tests/unit/shortcut-nav.test.ts
git commit -m "feat(shortcuts): walk board and list tasks with j/k/h/l, open with o"
```

---

### Task 5: Task detail shortcuts

**Files:**
- Modify: `src/components/task/TaskDetailDialog.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx:37`
- Modify: `src/components/task/TaskDetailView.tsx` (status/priority Select ~238–277, add bindings after `onDelete`)
- Modify: `src/components/task/ActivityFeed.tsx`
- Modify: `src/components/task/LabelPicker.tsx` (`Input.Input` in `LabelSelect`)

**Interfaces:**
- Consumes: `useShortcut` (Task 2); `collectNavItems`, `navTarget`, `focusNavItem` (Task 4); `useTaskSectionOpen` from `@/hooks/use-task-sections`.

- [ ] **Step 1: Scope markers**

`TaskDetailDialog.tsx` — add `data-shortcut-scope="detail"` to `<Modal.Content …>`.
`tasks/[taskId]/page.tsx` — add `data-shortcut-scope="detail"` to the `<main>`.

- [ ] **Step 2: `j`/`k` and focus restore in `TaskDetailDialog`**

Inside `TaskDetailDialog`, after `close()`:

```tsx
  // j/k step through the tasks of the view behind, in its order (same column
  // on the board). A task that is not there (a subtask, filtered out) stays put.
  function step(dir: 'next' | 'prev') {
    const target = navTarget(collectNavItems(), props.task.id, dir);
    if (!target) return;
    const next = new URLSearchParams(searchParams);
    next.set('task', target);
    router.replace(`?${next.toString()}`, { scroll: false });
  }
  useShortcut('detail.next', () => step('next'));
  useShortcut('detail.prev', () => step('prev'));
```

On `<Modal.Content>` add:

```tsx
        // Back to the card or row of the task shown last, which after j/k is
        // not the one that opened the dialog.
        onCloseAutoFocus={(event) => {
          if (focusNavItem(props.task.id)) event.preventDefault();
        }}
```

Imports: `useShortcut` from `@/lib/shortcuts/provider`; `collectNavItems, focusNavItem, navTarget` from `@/lib/shortcuts/nav`.

- [ ] **Step 3: Field shortcuts in `TaskDetailView`**

Add state next to the other field state:

```tsx
  // Controlled so s / p can open them from the keyboard.
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
```

Status `<Select.Root>` gets `open={statusOpen} onOpenChange={setStatusOpen}`; Priority `<Select.Root>` gets `open={priorityOpen} onOpenChange={setPriorityOpen}`.

Extract the assignee change so `i` reuses it — replace the `AssigneePicker` `onChange` body with a named function:

```tsx
  function assign(next: string | null) {
    const previous = assigneeId;
    setAssigneeId(next);
    patch({ taskId: task.id, assigneeId: next }, () => setAssigneeId(previous));
  }
```

and `onChange={assign}`.

Bindings, after `onDelete`:

```tsx
  // The fields' own controls, reached from the keyboard; no new UI.
  useShortcut('detail.title', () => {
    const input = document.getElementById('task-title') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
  useShortcut('detail.status', () => setStatusOpen(true));
  useShortcut('detail.priority', () => setPriorityOpen(true));
  useShortcut('detail.assignee', () => document.getElementById('task-assignee')?.click());
  useShortcut('detail.assignMe', () => {
    if (assigneeId !== currentUserId) assign(currentUserId);
  });
  useShortcut('detail.labels', () =>
    document.querySelector<HTMLElement>('[data-shortcut-target="labels"]')?.focus());
  useShortcut('detail.due', () => document.getElementById('task-due')?.click());
  useShortcut('detail.delete', () => { void onDelete(); });
```

Import `useState` (add to React import) and `useShortcut`. Check `AssigneePicker`'s `onChange` param type is `string | null` (match whatever it is).

- [ ] **Step 4: Label input target** — in `LabelPicker.tsx` `LabelSelect`, add `data-shortcut-target="labels"` to `<Input.Input …>`.

- [ ] **Step 5: `m` in `ActivityFeed`**

```tsx
  const composerRef = useRef<HTMLFormElement>(null);
  const [, setSectionOpen] = useTaskSectionOpen('activity');
  // m: open the section if collapsed, leave History, and put the caret in the composer.
  useShortcut('detail.comment', () => {
    setSectionOpen(true);
    setTab((t) => (t === 'history' ? 'comments' : t));
    requestAnimationFrame(() =>
      composerRef.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus());
  });
```

Add `ref={composerRef}` to the composer `<form>`. Imports: `useRef`, `useTaskSectionOpen` from `@/hooks/use-task-sections`, `useShortcut`.

- [ ] **Step 6: Verify**

Run: `yarn typecheck && yarn lint`
Run singly: `yarn playwright test tests/e2e/task-detail.spec.ts tests/e2e/comments.spec.ts`
Expected: PASS (controlled Selects behave as before).

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(shortcuts): task detail keys and j/k between tasks"
```

---

### Task 6: Go-to chords, help overlay, palette command

**Files:**
- Create: `src/components/shell/GoToShortcuts.tsx`
- Create: `src/components/shell/ShortcutHelpDialog.tsx`
- Modify: `src/components/shell/palette-actions.ts`
- Modify: `src/components/shell/CommandPalette.tsx`
- Modify: `src/components/shell/AppHeader.tsx`
- Test: `tests/unit/palette-actions.test.ts`

**Interfaces:**
- Consumes: `useShortcut`, `useIsMac` (Task 2); `SHORTCUTS`, `SHORTCUT_GROUPS` (Task 1); `formatBinding` (Task 1).
- Produces: `projectIdFromPath(pathname: string): string | undefined` (palette-actions); `PaletteAction['command']` widened to `'new-task' | 'shortcuts'`; `CommandPalette` prop `onShowShortcuts: () => void`; `ShortcutHelpDialog({ open, onOpenChange })`.

- [ ] **Step 1: Update palette tests (failing)**

In `tests/unit/palette-actions.test.ts`, change the first expectation's first row to `'New task', 'Keyboard shortcuts', 'New workspace',` and add:

```ts
  it('offers the shortcuts overlay as a command', () => {
    const byId = Object.fromEntries(paletteActions('acme', '/acme').map((a) => [a.id, a]));
    expect(byId.shortcuts.command).toBe('shortcuts');
    expect(byId.shortcuts.href).toBeUndefined();
  });
});

describe('projectIdFromPath', () => {
  it('reads the project id from any project route', () => {
    expect(projectIdFromPath('/acme/projects/p1')).toBe('p1');
    expect(projectIdFromPath('/acme/projects/p1/list')).toBe('p1');
    expect(projectIdFromPath('/acme/tasks')).toBeUndefined();
  });
```

(The final `});` closes the new describe; keep the existing `describe('paletteActions'` closing brace in place — put the new `it` inside it and the new `describe` after it.) Import `projectIdFromPath`.

Run: `yarn vitest run tests/unit/palette-actions.test.ts` — FAIL.

- [ ] **Step 2: palette-actions.ts**

```ts
  command?: 'new-task' | 'shortcuts';
```

Insert after the `new-task` action:

```ts
    { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'actions', command: 'shortcuts', keywords: ['keys', 'hotkeys', 'help'] },
```

Export the helper and use it inside `paletteActions`:

```ts
export function projectIdFromPath(pathname: string): string | undefined {
  return PROJECT_PATH.exec(pathname)?.[1];
}
```

(`const projectId = projectIdFromPath(pathname);`)

Run: `yarn vitest run tests/unit/palette-actions.test.ts` — PASS.

- [ ] **Step 3: CommandPalette runs the command after closing**

Add prop `onShowShortcuts: () => void`. Generalise the pending ref:

```tsx
  // Set when a command is picked; it runs once this dialog has finished
  // closing, so focus lands in the next dialog rather than on <body>.
  const pendingCommand = useRef<PaletteAction['command']>(undefined);
```

`run`:

```tsx
    if (action.command) {
      pendingCommand.current = action.command;
      onOpenChange(false);
    } else if (action.href) {
```

`onCloseAutoFocus`:

```tsx
          onCloseAutoFocus: (e) => {
            const command = pendingCommand.current;
            if (!command) return;
            pendingCommand.current = undefined;
            e.preventDefault();
            if (command === 'new-task') onNewTask();
            else onShowShortcuts();
          },
```

- [ ] **Step 4: `ShortcutHelpDialog.tsx`**

```tsx
'use client';

import * as Modal from '@/components/ui/modal';
import { formatBinding } from '@/lib/shortcuts/keys';
import { useIsMac } from '@/lib/shortcuts/provider';
import { SHORTCUT_GROUPS, SHORTCUTS } from '@/lib/shortcuts/registry';

/** Every shortcut, straight from the registry, so the list cannot drift from what the keys do. */
export function ShortcutHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMac = useIsMac();
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content aria-describedby={undefined} className="max-w-3xl">
        <div className="max-h-[80vh] overflow-y-auto p-5">
          <Modal.Title className="text-label-lg text-text-strong-950">Keyboard shortcuts</Modal.Title>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group} aria-labelledby={`shortcuts-${group}`}>
                <h3 id={`shortcuts-${group}`} className="text-label-sm text-text-sub-600">{group}</h3>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 text-paragraph-sm">
                      <dt className="text-text-strong-950">{s.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1 text-paragraph-xs text-text-soft-400">
                        {s.keys.map((spec, i) => (
                          <span key={spec} className="flex items-center gap-1">
                            {i > 0 && <span>or</span>}
                            {formatBinding(spec, isMac).map((caps, j) => (
                              <span key={j} className="flex items-center gap-1">
                                {j > 0 && <span>then</span>}
                                {caps.map((cap) => (
                                  <kbd key={cap} className="min-w-5 rounded border border-stroke-soft-200 px-1.5 text-center text-label-xs text-text-sub-600">
                                    {cap}
                                  </kbd>
                                ))}
                              </span>
                            ))}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
```

(Check `Modal.Content` default close button: it renders one unless `showClose={false}` — keep the default here.)

- [ ] **Step 5: `GoToShortcuts.tsx`**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { projectIdFromPath } from '@/components/shell/palette-actions';
import { useShortcut } from '@/lib/shortcuts/provider';

/** g then a letter: Jira-style jumps. Project views only bind inside a project. */
export function GoToShortcuts({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  const projectId = projectIdFromPath(pathname);
  const project = projectId ? `${base}/projects/${projectId}` : null;

  useShortcut('goto.home', () => router.push(base));
  useShortcut('goto.todo', () => router.push(`${base}/todo`));
  useShortcut('goto.calendar', () => router.push(project ? `${project}/calendar` : `${base}/calendar`));
  // The board lives at the project root (/board only redirects there).
  useShortcut('goto.board', () => router.push(project!), project !== null);
  useShortcut('goto.list', () => router.push(`${project}/list`), project !== null);
  useShortcut('goto.summary', () => router.push(`${project}/summary`), project !== null);
  return null;
}
```

- [ ] **Step 6: Wire into `AppHeader`**

```tsx
  const [showingShortcuts, setShowingShortcuts] = useState(false);
  useShortcut('general.help', () => setShowingShortcuts(true));
```

Pass `onShowShortcuts={() => setShowingShortcuts(true)}` to `CommandPalette`; render inside `<header>`:

```tsx
      <TaskNavShortcuts />
      <GoToShortcuts workspaceSlug={props.workspaceSlug} />
      <ShortcutHelpDialog open={showingShortcuts} onOpenChange={setShowingShortcuts} />
```

Update the AppHeader doc comment: it also owns the shortcuts overlay's open state.

- [ ] **Step 7: Verify**

Run: `yarn typecheck && yarn lint && yarn vitest run tests/unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src tests/unit/palette-actions.test.ts
git commit -m "feat(shortcuts): g chords, ? overlay and palette entry"
```

---

### Task 7: End-to-end spec

**Files:**
- Create: `tests/e2e/shortcuts.spec.ts`

**Interfaces:**
- Consumes: `createTask` from `tests/e2e/tasks.ts`; everything above.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Keys Tester');
  await page.getByLabel('Email', { exact: true }).fill(`keys-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Keys ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
}

test('board: j focuses, o opens, j/k step, i assigns, Escape returns focus', async ({ page }) => {
  await signUpWithProject(page);
  await createTask(page, 'First');
  await createTask(page, 'Second');

  // Cards are ordered by creation within the first column.
  await page.keyboard.press('j');
  const first = page.getByRole('button', { name: 'First', exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.getByRole('button', { name: 'Second', exact: true })).toBeFocused();
  await page.keyboard.press('k');
  await expect(first).toBeFocused();

  await page.keyboard.press('o');
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByLabel('Title')).toHaveValue('First');

  await page.keyboard.press('j');
  await expect(dialog.getByLabel('Title')).toHaveValue('Second');

  // Typing in the title never fires shortcuts.
  await dialog.getByLabel('Title').click();
  await page.keyboard.type(' jk');
  await expect(dialog.getByLabel('Title')).toHaveValue('Second jk');
  await expect(page).toHaveURL(/task=/);
  await dialog.focus();

  await page.keyboard.press('i');
  await expect(dialog.getByLabel('Assignee')).toContainText('Keys Tester');

  // s opens the Status list; j inside it belongs to the list, not to task stepping.
  await page.keyboard.press('s');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('j');
  await expect(dialog.getByLabel('Title')).toHaveValue('Second jk');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);
  await expect(page.getByRole('button', { name: 'Second jk', exact: true })).toBeFocused();
});

test('g chords move between views and ? lists the shortcuts', async ({ page }) => {
  await signUpWithProject(page);

  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page).toHaveURL(/\/projects\/[^/]+\/list/);

  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page).toHaveURL(/\/projects\/[^/?]+(\?|$)/);

  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/todo/);

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Assign to me')).toBeVisible();
});
```

Notes for the implementer: the title Field's blur-save writes "Second jk"; the card name in the last assertion reflects it after refresh. If the dialog's focus target is not the dialog element after clicking the title, `dialog.focus()` (Locator.focus) puts focus back on the `role=dialog` element, which is focusable (`onOpenAutoFocus` focuses it). If `Assignee` label lookup fails, use `dialog.locator('#task-assignee')`.

- [ ] **Step 2: Run only this spec**

Run: `yarn playwright test tests/e2e/shortcuts.spec.ts`
Expected: 2 passed. Fix the app (not the assertion) for any real behaviour gap; adjust selectors only when the behaviour is right but the locator is wrong.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/shortcuts.spec.ts
git commit -m "test(shortcuts): e2e for board nav, detail keys, chords and help"
```

---

### Task 8: Wrap-up

- [ ] **Step 1:** `yarn typecheck && yarn lint && yarn vitest run tests/unit` — all PASS.
- [ ] **Step 2:** `graphify update .` (per repo CLAUDE.md).
- [ ] **Step 3:** Manual checks (record results in the handoff): Mac vs Linux key labels in `?`; description editor and comment composer swallow letters; `a` / `d` popovers open and own their keys; `l` on board focused card moves column, `l` in detail focuses label input; arrows scroll the page with nothing focused.
- [ ] **Step 4:** Commit any graph update if tracked: `git add -A graphify-out && git commit -m "chore: update graph"` (skip if nothing changed or ignored).
