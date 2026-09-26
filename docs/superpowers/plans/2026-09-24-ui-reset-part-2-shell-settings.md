# UI Reset — Part 2: App Shell and Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app shell (rail, mobile drawer, workspace switcher, project header, view tabs, new-project dialog) and the two settings pages on Align UI, adding Kibo's Theme Switcher and a Kibo Relative Time clock preview.

**Architecture:** Shell and settings components are rewritten in place with Align primitives from Part 1. Kibo's Theme Switcher and Relative Time are copied from `haydenbleasel/kibo@3d63cdb` into `src/components/kibo-ui/` and adapted (Tabler icons, Align tokens, no `@radix-ui/react-use-controllable-state`). Behaviour, routes and accessible names do not change.

**Tech Stack:** as Part 1, plus `motion` 13.4.3 (Theme Switcher pill animation).

**Spec:** `docs/superpowers/specs/2026-09-24-ui-reset-design.md` (§4, §5.2, §5.3, §10).

**Plan series:** Part 1 (`…-part-1-foundation.md`, must be complete) → **Part 2 (this)** → Part 3 (`…-part-3-tasks-editor.md`) → Part 4 (`…-part-4-kanban-cleanup.md`).

## Global Constraints

- Work on branch `feat/ui-reset`. Commit after every task. Conventional Commits, **no `Co-Authored-By` or any attribution trailer**.
- Do not change the `version` field in `package.json`.
- Pin every new dependency exactly: `yarn add -E <pkg>@<version>`.
- `AGENTS.md`: read the matching guide in `node_modules/next/dist/docs/` before writing Next-specific code.
- Icons only from `@tabler/icons-react`.
- New code uses Align token classes and Align components (`@/components/ui/*`), never `@/components/legacy-ui/*`, never bridged shadcn names (`bg-background`, `text-muted-foreground`, `border-border`, …), never hex colours.
- Accessible names and roles from spec §4.1 are preserved exactly. The e2e specs are not edited.
- Kibo copies carry a header comment naming the upstream path and commit and listing every adaptation.
- Verification gate at the end of every task: `yarn typecheck && yarn lint && yarn test`, plus `yarn e2e` at the end of Tasks 2 and 3.
- Align namespace values passed as props (`as={IconX}` on `*.Icon`, `icon=` on `Modal.Header`, `*Variants()` exports) only work inside `'use client'` files — Tabler icons are forwardRef objects and cannot cross the server→client boundary.

## Review Focus

- **Theme switcher before hydration** → server and first client render must match (no hydration warning), and the control must not collapse to nothing and shift the rail; it renders all three buttons unselected until mounted.
- **Keyboard on the theme switcher** → it is a radio group: one tab stop, arrow keys move and select (Task 1 implements; Task 1 Step 5 checks by hand).
- **Kibo Relative Time with custom format options** → upstream drops `timeZone` whenever options are passed, so every zone shows the browser's time. Our copy always applies the zone (Task 3 test pins this).
- **Workspace zone equals the viewer's zone** → show one line, not two identical ones (Task 3 test pins this).
- **Mobile drawer** → opens from the left, traps focus, closes on Escape and on navigating; Radix warns on a dialog without a title, so it keeps a visually hidden title.

---

### Task 1: Kibo Theme Switcher

**Files:**
- Create: `src/components/kibo-ui/theme-switcher/index.tsx`
- Create: `src/components/shell/ThemeControl.tsx`
- Delete: `src/components/shell/ThemeToggle.tsx`
- Modify: `src/components/shell/Rail.tsx` (import only; the rail itself is rebuilt in Task 2)

**Interfaces:**
- Produces: `type Theme = 'light' | 'dark' | 'system'`; `ThemeSwitcher({ value?: Theme; onChange: (theme: Theme) => void; className?: string })`; `ThemeControl()` — `ThemeSwitcher` wired to `next-themes`.

- [ ] **Step 1: Add the dependency**

```bash
yarn add -E motion@13.4.3
```

- [ ] **Step 2: Write the adapted component**

Create `src/components/kibo-ui/theme-switcher/index.tsx`:

```tsx
'use client';

/**
 * Kibo UI Theme Switcher — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/theme-switcher/index.tsx. Adapted:
 * - Tabler icons instead of lucide.
 * - radiogroup / radio / aria-checked semantics, one tab stop, arrow keys select.
 * - Controlled only (next-themes owns the state), so @radix-ui/react-use-controllable-state
 *   is not needed.
 * - Renders all three buttons unselected before mount instead of returning null, using
 *   useSyncExternalStore rather than a setState-in-effect mount flag. Same markup on the
 *   server and the first client render, and no layout shift.
 * - Align tokens.
 */

import { IconDeviceDesktop, IconMoon, IconSun, type TablerIcon } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/utils/cn';

export type Theme = 'light' | 'dark' | 'system';

const themes: { key: Theme; icon: TablerIcon; label: string }[] = [
  { key: 'system', icon: IconDeviceDesktop, label: 'System theme' },
  { key: 'light', icon: IconSun, label: 'Light theme' },
  { key: 'dark', icon: IconMoon, label: 'Dark theme' },
];

export type ThemeSwitcherProps = {
  value?: Theme;
  onChange: (theme: Theme) => void;
  className?: string;
};

export function ThemeSwitcher({ value, onChange, className }: ThemeSwitcherProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // Until mounted the stored theme is unknown; "system" holds the tab stop meanwhile.
  const current: Theme = mounted ? (value ?? 'system') : 'system';

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = themes.findIndex((t) => t.key === current);
    const step = event.key === 'ArrowRight' ? 1 : themes.length - 1;
    const next = themes[(index + step) % themes.length];
    onChange(next.key);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-theme-key="${next.key}"]`)
      ?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className={cn(
        'relative isolate flex h-8 items-center rounded-full bg-bg-white-0 p-1 ring-1 ring-inset ring-stroke-soft-200',
        className,
      )}
    >
      {themes.map(({ key, icon: Icon, label }) => {
        const active = mounted && current === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            data-theme-key={key}
            aria-checked={active}
            aria-label={label}
            tabIndex={current === key ? 0 : -1}
            onClick={() => onChange(key)}
            className="relative size-6 rounded-full"
          >
            {active && (
              <motion.div
                layoutId="activeTheme"
                transition={{ type: 'spring', duration: 0.5 }}
                className="absolute inset-0 rounded-full bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200"
              />
            )}
            <Icon
              aria-hidden="true"
              className={cn(
                'relative z-10 m-auto size-4',
                active ? 'text-text-strong-950' : 'text-text-soft-400',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire it to next-themes**

Create `src/components/shell/ThemeControl.tsx`:

```tsx
'use client';

import { useTheme } from 'next-themes';
import { ThemeSwitcher, type Theme } from '@/components/kibo-ui/theme-switcher';

export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  return <ThemeSwitcher value={theme as Theme | undefined} onChange={setTheme} />;
}
```

In `src/components/shell/Rail.tsx`, replace `import { ThemeToggle } from '@/components/shell/ThemeToggle';` with `import { ThemeControl } from '@/components/shell/ThemeControl';` and `<ThemeToggle />` with `<ThemeControl />`. Then:

```bash
git rm -q src/components/shell/ThemeToggle.tsx
```

- [ ] **Step 4: Gate**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

- [ ] **Step 5: Check by hand**

`yarn dev`, sign in, open a workspace. In the rail: Tab lands on the switcher once; Left/Right arrows change the theme and move focus; the pill animates; reloading keeps the choice; with the OS in dark mode, choosing Light makes the whole app light. The browser console shows no hydration warning.

- [ ] **Step 6: Commit**

```bash
git add package.json yarn.lock src/components/kibo-ui/theme-switcher src/components/shell
git commit -m "feat(ui): Kibo theme switcher with radiogroup semantics"
```

---

### Task 2: Shell — rail, drawer, workspace switcher, header, tabs, new project

**Files (all full rewrites):**
- `src/components/shell/Rail.tsx`
- `src/components/shell/WorkspaceSwitcher.tsx`
- `src/components/shell/NewProjectDialog.tsx`
- `src/components/shell/ProjectHeader.tsx`
- `src/components/shell/ViewTabs.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/layout.tsx:27` (`bg-background` → `bg-bg-white-0`)

**Interfaces:**
- Consumes: `Drawer`, `Dropdown`, `Modal`, `CompactButton`, `Button` (Part 1 Task 4); `TextField`, `FormError` (Part 1 Task 6); `ThemeControl` (Task 1).
- Produces: unchanged component names and props — `Rail(props: { workspaceSlug; workspaces; projects; userName })`, `WorkspaceSwitcher({ current, workspaces })`, `NewProjectDialog({ workspaceSlug })`, `ProjectHeader({ name, basePath, children? })`, `ViewTabs({ basePath })`.

- [ ] **Step 1: Rail and mobile drawer**

Replace `src/components/shell/Rail.tsx`:

```tsx
'use client';

import { IconMenu2, IconSettings } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { NewProjectDialog } from '@/components/shell/NewProjectDialog';
import { ThemeControl } from '@/components/shell/ThemeControl';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import * as CompactButton from '@/components/ui/compact-button';
import * as Drawer from '@/components/ui/drawer';
import type { ProjectSummary } from '@/server/projects/queries';
import type { WorkspaceSummary } from '@/server/workspaces/queries';
import { cn } from '@/utils/cn';

type Props = {
  workspaceSlug: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  userName: string;
};

const navItem =
  'flex items-center gap-2 rounded-lg px-2.5 text-label-sm transition-colors duration-150';
const navIdle = 'text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950';
const navActive = 'bg-bg-weak-50 text-text-strong-950';

function RailBody({ workspaceSlug, workspaces, projects }: Props) {
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  const onMembers = pathname.endsWith('/settings/members');
  const onGeneral = pathname.endsWith('/settings/general');

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full w-64 flex-col gap-4 border-r border-stroke-soft-200 bg-bg-white-0 p-3"
    >
      <WorkspaceSwitcher current={workspaceSlug} workspaces={workspaces} />

      <div className="flex-1 space-y-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-subheading-2xs uppercase text-text-soft-400">Projects</span>
          <NewProjectDialog workspaceSlug={workspaceSlug} />
        </div>

        {projects.length === 0 ? (
          <p className="px-2.5 py-3 text-paragraph-sm text-text-sub-600">
            No projects yet. Create one to get started.
          </p>
        ) : (
          projects.map((project) => {
            const active = params.projectId === project.id;
            return (
              <Link
                key={project.id}
                href={`/${workspaceSlug}/projects/${project.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(navItem, 'h-9', active ? navActive : navIdle)}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-primary-base' : 'bg-bg-soft-200')}
                />
                <span className="truncate">{project.name}</span>
                {project.openTaskCount > 0 && (
                  <span className="tabular ml-auto text-label-xs text-text-soft-400">
                    {project.openTaskCount}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>

      <div className="space-y-1 border-t border-stroke-soft-200 pt-3">
        <Link
          href={`/${workspaceSlug}/settings/members`}
          aria-current={onMembers ? 'page' : undefined}
          className={cn(navItem, 'h-10', onMembers ? navActive : navIdle)}
        >
          <IconSettings className="size-5" aria-hidden="true" />
          Settings
        </Link>
        <Link
          href={`/${workspaceSlug}/settings/general`}
          aria-current={onGeneral ? 'page' : undefined}
          className={cn(navItem, 'h-10 pl-9', onGeneral ? navActive : navIdle)}
        >
          General
        </Link>
        <div className="flex items-center justify-between px-2.5 pt-2">
          <span className="text-paragraph-xs text-text-soft-400">Theme</span>
          <ThemeControl />
        </div>
      </div>
    </nav>
  );
}

export function Rail(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="hidden lg:block">
        <RailBody {...props} />
      </aside>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger asChild>
          <CompactButton.Root
            variant="stroke"
            size="large"
            aria-label="Open navigation"
            className="fixed left-3 top-3 z-40 size-11 lg:hidden"
          >
            <CompactButton.Icon as={IconMenu2} />
          </CompactButton.Root>
        </Drawer.Trigger>
        <Drawer.Content side="left" aria-describedby={undefined} className="max-w-64">
          <Drawer.Title className="sr-only">Workspace navigation</Drawer.Title>
          {/* Navigating closes the drawer: the pathname changes, and a click on any link
              inside bubbles here first. */}
          <div className="h-full" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
            <RailBody {...props} />
          </div>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
```

Note: the old Sheet did not close on navigation either; closing on link click is the only intended change here and fixes the drawer staying open over the new page. If you prefer strict parity, drop the `onClickCapture` wrapper.

- [ ] **Step 2: Workspace switcher**

Replace `src/components/shell/WorkspaceSwitcher.tsx`:

```tsx
'use client';

import { IconCheck, IconPlus, IconSelector } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import * as Dropdown from '@/components/ui/dropdown';
import type { WorkspaceSummary } from '@/server/workspaces/queries';
import { cn } from '@/utils/cn';

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: WorkspaceSummary[];
}) {
  const router = useRouter();
  const active = workspaces.find((w) => w.slug === current);

  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="flex h-11 w-full items-center justify-between gap-2 rounded-10 px-2.5 text-left text-label-md text-text-strong-950 transition-colors duration-150 hover:bg-bg-weak-50 data-[state=open]:bg-bg-weak-50">
        <span className="truncate">{active?.name ?? 'Workspace'}</span>
        <IconSelector className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content align="start" className="w-56">
        {workspaces.map((workspace) => (
          <Dropdown.Item key={workspace.id} onSelect={() => router.push(`/${workspace.slug}`)}>
            <Dropdown.ItemIcon
              as={IconCheck}
              className={cn(workspace.slug === current ? 'opacity-100' : 'opacity-0')}
            />
            <span className="truncate">{workspace.name}</span>
          </Dropdown.Item>
        ))}
        <Dropdown.Separator />
        <Dropdown.Item onSelect={() => router.push('/new-workspace')}>
          <Dropdown.ItemIcon as={IconPlus} />
          New workspace
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
```

- [ ] **Step 3: New project dialog**

Replace `src/components/shell/NewProjectDialog.tsx`:

```tsx
'use client';

import { IconFolderPlus, IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Modal from '@/components/ui/modal';
import { createProjectAction } from '@/server/projects/actions';

export function NewProjectDialog({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await createProjectAction(workspaceSlug, { name });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.push(`/${workspaceSlug}/projects/${result.data.id}`);
  }

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Modal.Trigger asChild>
        <CompactButton.Root variant="ghost" size="medium" aria-label="New project">
          <CompactButton.Icon as={IconPlus} />
        </CompactButton.Root>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header
          icon={IconFolderPlus}
          title="New project"
          description="It starts with three columns: Todo, In Progress, and Done."
        />
        <form onSubmit={onSubmit}>
          <Modal.Body className="flex flex-col gap-3">
            <TextField id="project-name" label="Project name" name="name" required maxLength={64} autoFocus />
            {error && <FormError>{error}</FormError>}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close asChild>
              <Button.Root type="button" variant="neutral" mode="stroke" size="small" className="w-full">
                Cancel
              </Button.Root>
            </Modal.Close>
            <Button.Root type="submit" size="small" disabled={pending} className="w-full">
              {pending ? 'Creating…' : 'Create project'}
            </Button.Root>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
```

- [ ] **Step 4: Project header and view tabs**

Replace `src/components/shell/ProjectHeader.tsx`:

```tsx
import { ViewTabs } from '@/components/shell/ViewTabs';

// pl-16 on small screens reserves room for the fixed drawer trigger in Rail, so
// the title never sits underneath it.
export function ProjectHeader({
  name,
  basePath,
  children,
}: {
  name: string;
  basePath: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 pl-16 lg:px-6 lg:pl-6">
      <h1 className="min-w-0 flex-1 truncate text-label-lg text-text-strong-950">{name}</h1>
      <ViewTabs basePath={basePath} />
      {children}
    </header>
  );
}
```

Replace `src/components/shell/ViewTabs.tsx` (links, not Align's Tabs: each view is its own route, so Radix Tabs' in-page panels do not fit; the look copies Align's segmented control):

```tsx
'use client';

import { IconLayoutKanban, IconList } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/utils/cn';

export function ViewTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const onBoard = pathname.endsWith('/board');

  const views = [
    { href: basePath, label: 'List', icon: IconList, active: !onBoard },
    { href: `${basePath}/board`, label: 'Board', icon: IconLayoutKanban, active: onBoard },
  ];

  return (
    <div
      role="tablist"
      aria-label="Project views"
      className="flex items-center gap-1 rounded-10 bg-bg-weak-50 p-1"
    >
      {views.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          role="tab"
          aria-selected={active}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm transition-colors duration-150',
            active
              ? 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs'
              : 'text-text-sub-600 hover:text-text-strong-950',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </div>
  );
}
```

In `src/app/(app)/[workspaceSlug]/layout.tsx`, change `className="flex min-h-dvh bg-background"` to `className="flex min-h-dvh bg-bg-white-0"`.

- [ ] **Step 5: Gate, e2e, visual**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

Run: `yarn e2e`
Expected: all pass (every spec creates a project through `New project` / `Project name` / `Create project` and switches views through `tab "Board"`).

Run `scripts/screenshots.mjs` (see Part 1 Task 6) and review `home-*`, `list-*`, `board-*` for the rail and header, at 1280 and 390, light and dark. At 390 the menu button sits top-left without covering the title.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell "src/app/(app)/[workspaceSlug]/layout.tsx"
git commit -m "feat(ui): rebuild app shell on Align (rail, drawer, switcher, tabs, new project)"
```

---

### Task 3: Settings — timezone with live clock, invitations, members

**Files:**
- Create: `src/components/kibo-ui/relative-time/index.tsx`
- Create: `src/components/settings/ZonePreview.tsx`
- Modify (full rewrite): `src/components/settings/TimezoneForm.tsx`, `src/components/settings/InviteForm.tsx`, `src/components/settings/MemberTable.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/settings/general/page.tsx`, `src/app/(app)/[workspaceSlug]/settings/members/page.tsx` (heading classes)
- Test: `tests/unit/relative-time.test.ts`

**Interfaces:**
- Produces:
  - `formatZoneTime(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions): string` and `formatZoneDate(...)` (exported for tests), `RelativeTime`, `RelativeTimeZone({ zone })`, `RelativeTimeZoneDisplay`, `RelativeTimeZoneDate`, `RelativeTimeZoneLabel` from `@/components/kibo-ui/relative-time`.
  - `previewZones(workspaceZone: string, localZone: string): { label: string; zone: string }[]` and `ZonePreview({ workspaceZone })` from `@/components/settings/ZonePreview`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/relative-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatZoneTime } from '@/components/kibo-ui/relative-time';
import { previewZones } from '@/components/settings/ZonePreview';

const noonUtc = new Date('2026-01-15T12:00:00Z');

describe('formatZoneTime', () => {
  it('applies the zone even when format options are passed', () => {
    // Upstream Kibo only set timeZone when options were omitted, so every custom
    // format showed the browser's clock instead of the zone's.
    expect(formatZoneTime(noonUtc, 'Asia/Yerevan', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
      .toBe('16:00');
    expect(formatZoneTime(noonUtc, 'America/New_York', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
      .toBe('07:00');
  });
});

describe('previewZones', () => {
  it('shows the workspace and the viewer zone', () => {
    expect(previewZones('Europe/Berlin', 'Asia/Yerevan')).toEqual([
      { label: 'Workspace time', zone: 'Europe/Berlin' },
      { label: 'Your time', zone: 'Asia/Yerevan' },
    ]);
  });

  it('shows one line when they are the same', () => {
    expect(previewZones('UTC', 'UTC')).toEqual([{ label: 'Workspace time', zone: 'UTC' }]);
  });
});
```

Run: `yarn test tests/unit/relative-time.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/kibo-ui/relative-time"`.

- [ ] **Step 2: Adapted Relative Time**

Create `src/components/kibo-ui/relative-time/index.tsx`:

```tsx
'use client';

/**
 * Kibo UI Relative Time — haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/relative-time/index.tsx. A live clock per timezone (not "n minutes ago").
 * Adapted:
 * - The zone is always applied; upstream dropped timeZone whenever format options were
 *   passed.
 * - Ticking clock only (no controlled `time`), so plain useState replaces
 *   @radix-ui/react-use-controllable-state.
 * - Align tokens. Render it only after mount: the clock differs between server and client.
 */

import { createContext, type HTMLAttributes, useContext, useEffect, useState } from 'react';
import { cn } from '@/utils/cn';

export function formatZoneTime(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
    timeZone,
  }).format(date);
}

export function formatZoneDate(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', ...options, timeZone }).format(date);
}

type RelativeTimeContextValue = {
  time: Date;
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  timeFormatOptions?: Intl.DateTimeFormatOptions;
};

const RelativeTimeContext = createContext<RelativeTimeContextValue>({ time: new Date(0) });
const RelativeTimeZoneContext = createContext<{ zone: string }>({ zone: 'UTC' });

export type RelativeTimeProps = HTMLAttributes<HTMLDivElement> & {
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  timeFormatOptions?: Intl.DateTimeFormatOptions;
};

export function RelativeTime({ dateFormatOptions, timeFormatOptions, className, ...props }: RelativeTimeProps) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <RelativeTimeContext.Provider value={{ time, dateFormatOptions, timeFormatOptions }}>
      <div className={cn('grid gap-2', className)} {...props} />
    </RelativeTimeContext.Provider>
  );
}

export function RelativeTimeZone({
  zone,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { zone: string }) {
  return (
    <RelativeTimeZoneContext.Provider value={{ zone }}>
      <div className={cn('flex items-center gap-2', className)} {...props} />
    </RelativeTimeZoneContext.Provider>
  );
}

export function RelativeTimeZoneDisplay({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { time, timeFormatOptions } = useContext(RelativeTimeContext);
  const { zone } = useContext(RelativeTimeZoneContext);
  return (
    <span className={cn('tabular text-label-sm text-text-strong-950', className)} {...props}>
      {formatZoneTime(time, zone, timeFormatOptions)}
    </span>
  );
}

export function RelativeTimeZoneDate({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { time, dateFormatOptions } = useContext(RelativeTimeContext);
  const { zone } = useContext(RelativeTimeZoneContext);
  return (
    <span className={cn('text-paragraph-xs text-text-sub-600', className)} {...props}>
      {formatZoneDate(time, zone, dateFormatOptions)}
    </span>
  );
}

export function RelativeTimeZoneLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-md bg-bg-weak-50 px-1.5 font-mono text-label-2xs text-text-sub-600',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Zone preview**

Create `src/components/settings/ZonePreview.tsx`:

```tsx
'use client';

import { useSyncExternalStore } from 'react';
import {
  RelativeTime, RelativeTimeZone, RelativeTimeZoneDisplay, RelativeTimeZoneLabel,
} from '@/components/kibo-ui/relative-time';

export function previewZones(workspaceZone: string, localZone: string) {
  const zones = [{ label: 'Workspace time', zone: workspaceZone }];
  if (localZone !== workspaceZone) zones.push({ label: 'Your time', zone: localZone });
  return zones;
}

/** Live clock for the selected zone and the viewer's, so the setting's effect is visible. */
export function ZonePreview({ workspaceZone }: { workspaceZone: string }) {
  // The clock and the browser zone only exist on the client (spec §5.2).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return <div className="h-12" aria-hidden="true" />;

  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <RelativeTime timeFormatOptions={{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }}>
      {previewZones(workspaceZone, localZone).map(({ label, zone }) => (
        <RelativeTimeZone key={label} zone={zone}>
          <span className="w-28 text-paragraph-sm text-text-sub-600">{label}</span>
          <RelativeTimeZoneDisplay />
          <RelativeTimeZoneLabel>{zone}</RelativeTimeZoneLabel>
        </RelativeTimeZone>
      ))}
    </RelativeTime>
  );
}
```

Run: `yarn test tests/unit/relative-time.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Timezone form**

Replace `src/components/settings/TimezoneForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ZonePreview } from '@/components/settings/ZonePreview';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import { updateWorkspaceSettingsAction } from '@/server/settings/actions';

// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
];

export function TimezoneForm({
  workspaceSlug,
  current,
  canEdit,
}: {
  workspaceSlug: string;
  current: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(current);
  const [pending, setPending] = useState(false);

  async function onSave() {
    setPending(true);
    const result = await updateWorkspaceSettingsAction(workspaceSlug, { timezone });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Timezone updated.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex flex-col gap-1">
        <Label.Root htmlFor="timezone">Workspace timezone</Label.Root>
        <Select.Root value={timezone} onValueChange={setTimezone} disabled={!canEdit || pending}>
          <Select.Trigger id="timezone" className="w-full sm:w-72" aria-describedby="timezone-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {ZONES.map((zone) => <Select.Item key={zone} value={zone}>{zone}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="timezone-hint">
          Due dates and “today” are calculated in this timezone for everyone in the workspace.
        </Hint.Root>
      </div>

      <ZonePreview workspaceZone={timezone} />

      {canEdit && (
        <div>
          <Button.Root size="small" onClick={onSave} disabled={pending || timezone === current}>
            {pending ? 'Saving…' : 'Save'}
          </Button.Root>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Invite form (role as radio group)**

Replace `src/components/settings/InviteForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/TextField';
import * as Button from '@/components/ui/button';
import * as Label from '@/components/ui/label';
import * as Radio from '@/components/ui/radio';
import { inviteMemberAction } from '@/server/members/actions';

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const;

export function InviteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = event.currentTarget;
    const email = String(new FormData(form).get('email'));
    const result = await inviteMemberAction(workspaceSlug, { email, role });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    toast.success(`Invitation sent to ${email}.`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200"
    >
      <TextField
        id="invite-email" label="Invite by email" name="email" type="email" required
        autoComplete="off" placeholder="teammate@example.com"
        aria-describedby={error ? 'invite-error' : undefined}
      />

      <div className="flex flex-col gap-2">
        <span id="invite-role-label" className="text-label-sm text-text-strong-950">Role</span>
        <Radio.Group
          aria-labelledby="invite-role-label"
          value={role}
          onValueChange={(v) => setRole(v as 'admin' | 'member')}
          className="flex gap-5"
        >
          {ROLES.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-2">
              <Radio.Item value={value} id={`invite-role-${value}`} />
              <Label.Root htmlFor={`invite-role-${value}`} className="text-paragraph-sm">
                {label}
              </Label.Root>
            </div>
          ))}
        </Radio.Group>
        <p className="text-paragraph-xs text-text-sub-600">
          Admins can invite and remove people. Members cannot.
        </p>
      </div>

      {error && <FormError id="invite-error">{error}</FormError>}

      <div>
        <Button.Root type="submit" size="small" disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button.Root>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Member table**

Replace `src/components/settings/MemberTable.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import * as Avatar from '@/components/ui/avatar';
import * as Button from '@/components/ui/button';
import * as Select from '@/components/ui/select';
import { changeMemberRoleAction, removeMemberAction } from '@/server/members/actions';
import type { MemberRow } from '@/server/labels/queries';
import type { WorkspaceRole } from '@/lib/session';

export function MemberTable({
  members,
  workspaceSlug,
  currentUserId,
  currentRole,
}: {
  members: MemberRow[];
  workspaceSlug: string;
  currentUserId: string;
  currentRole: WorkspaceRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onRoleChange(userId: string, role: WorkspaceRole) {
    startTransition(async () => {
      const result = await changeMemberRoleAction(workspaceSlug, { userId, role });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function onRemove(member: MemberRow) {
    if (!confirm(`Remove ${member.name} from this workspace?`)) return;
    startTransition(async () => {
      const result = await removeMemberAction(workspaceSlug, { userId: member.userId });
      if (!result.ok) toast.error(result.error);
      else toast.success(`${member.name} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-stroke-soft-200">
      <table className="w-full border-collapse text-paragraph-sm">
        <thead className="bg-bg-weak-50">
          <tr className="text-left text-label-xs uppercase text-text-soft-400">
            <th scope="col" className="px-4 py-2 font-medium">Name</th>
            <th scope="col" className="px-4 py-2 font-medium">Role</th>
            <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId} className="border-t border-stroke-soft-200">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar.Root size="32" color="blue">{member.name.slice(0, 1)}</Avatar.Root>
                  <div className="min-w-0">
                    <div className="truncate text-label-sm text-text-strong-950">{member.name}</div>
                    <div className="truncate text-paragraph-xs text-text-sub-600">{member.email}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                {currentRole === 'owner' ? (
                  <Select.Root
                    size="small"
                    value={member.role}
                    disabled={pending}
                    onValueChange={(v) => onRoleChange(member.userId, v as WorkspaceRole)}
                  >
                    <Select.Trigger className="w-32" aria-label={`Role for ${member.name}`}>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="owner">Owner</Select.Item>
                      <Select.Item value="admin">Admin</Select.Item>
                      <Select.Item value="member">Member</Select.Item>
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <span className="capitalize text-text-sub-600">{member.role}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {(currentRole === 'owner' || currentRole === 'admin')
                  && member.userId !== currentUserId && (
                  <Button.Root
                    type="button"
                    variant="error"
                    mode="ghost"
                    size="xsmall"
                    onClick={() => onRemove(member)}
                    disabled={pending}
                  >
                    Remove
                  </Button.Root>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Settings page headings**

In both `src/app/(app)/[workspaceSlug]/settings/general/page.tsx` and `.../settings/members/page.tsx`, replace
`className="text-2xl font-semibold text-foreground"` with `className="text-title-h5 text-text-strong-950"` and
`className="mt-1 text-sm text-muted-foreground"` with `className="mt-1 text-paragraph-sm text-text-sub-600"`.

Check: `grep -nE "text-foreground|text-muted-foreground|bg-background" "src/app/(app)/[workspaceSlug]/settings" -r` → no output.

- [ ] **Step 8: Gate, e2e, visual**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass.

Run: `yarn e2e`
Expected: all pass.

Run `scripts/screenshots.mjs` and review `settings-general-*` (the clock ticks; two rows unless the browser zone equals the workspace zone) and `settings-members-*` (avatar, role select, remove action), light and dark, 1280 and 390. By hand: pick a different zone in the select and see the workspace clock change before saving.

- [ ] **Step 9: Commit**

```bash
git add src/components/kibo-ui/relative-time src/components/settings "src/app/(app)/[workspaceSlug]/settings" tests/unit/relative-time.test.ts
git commit -m "feat(ui): rebuild settings on Align with a live timezone preview"
```
