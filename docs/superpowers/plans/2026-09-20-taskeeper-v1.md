# Taskeeper v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user task manager where a team signs up, creates a workspace, invites members, and manages tasks across projects in list and board views.

**Architecture:** Next.js App Router with React Server Components for reads and Server Actions for writes. All database access is funnelled through `src/server/*`, which every function enters holding a `WorkspaceContext` resolved server-side from the URL slug plus a membership check — that is the single tenant-isolation boundary. Drizzle over a plain `node-postgres` pool keeps the app portable between serverless and self-hosted deployments.

**Tech Stack:** Next.js 16.3.5, React 19.3.0, TypeScript, Drizzle ORM 0.45.2 + drizzle-kit 0.31.10, PostgreSQL via `pg` 8.23, better-auth 1.7.5 (`organization` plugin), Tailwind CSS 4.3.3, shadcn/ui, Lucide icons, dnd-kit 6.3.1, Zod 4.6.5, Vitest, Playwright, Resend.

**Spec:** `docs/superpowers/specs/2026-09-20-taskeeper-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Package manager is Yarn 4, activated through corepack** and pinned in `package.json`'s
  `packageManager` field. Node 22.x. Never mix in an `npm install` — a stray `package-lock.json`
  next to `yarn.lock` is a review rejection.
- **Yarn uses the `node-modules` linker**, not PnP. Next.js and the shadcn CLI both still
  misbehave under PnP resolution.
- **Exact dependency versions** — pin these, do not float: `next@16.3.5`, `react@19.3.0`, `react-dom@19.3.0`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `pg@8.23.0`, `better-auth@1.7.5`, `tailwindcss@4.3.3`, `@dnd-kit/core@6.3.1`, `zod@4.6.5`.
- **Do not install `@neondatabase/serverless`.** Database access is one code path: a `node-postgres` pool over `DATABASE_URL` (spec §7). Adding a provider-specific driver breaks self-hosting.
- **All routes run on the Node runtime.** Never add `export const runtime = 'edge'`.
- **No session-level Postgres state** — no `SET`, `LISTEN`, or session temp tables. PgBouncer in transaction mode drops them (spec §7).
- **Components never import from `src/db/`.** They import from `src/server/` only. A component importing `db` is a review rejection.
- **Every `src/server/**` exported function takes `ctx: WorkspaceContext` as its first parameter** and filters every query on `ctx.workspaceId` (spec §4).
- **Server Actions never throw across the boundary.** They return `Result<T> = { ok: true; data: T } | { ok: false; error: string }` (spec §5).
- **No raw hex colors in components.** Use semantic Tailwind tokens (`bg-card`, `text-muted-foreground`). A hex literal outside `globals.css` is a review rejection (spec §6.1).
- **No emoji as icons.** Lucide SVG icons only.
- **Never compute "today" from the server clock.** All calendar-date comparisons go through `src/lib/dates.ts` with an explicit timezone. `CURRENT_DATE` and bare `new Date()` for date logic are review rejections (spec §3.4).
- **`TZ=UTC`** is set in every environment, including the test runner.
- **Focus rings are never removed.** No `outline: none` without a replacement ring.
- **TDD is mandatory.** Write the failing test, watch it fail, implement, watch it pass, commit. A step that says "run it to verify it fails" is not optional — a test that has never failed has not been shown to test anything.
- **Commit at the end of every task**, with a Conventional Commits message. Never add `Co-Authored-By` trailers.

---

## Amendment A — server module split (pre-flight ruling, binding)

**This section overrides any `'use server'` placement or file path shown in a task
body below.** Two defects were found in this plan before execution began.

### A1. `slugify` must not live in a `'use server'` module

Task 8 defines `slugify()` — a synchronous function — inside
`src/server/workspaces/actions.ts`, which carries `'use server'`. Next.js allows
only async exports from such a module, so this fails at build, and Task 9 imports
it from there.

**Do this instead:** `slugify` lives in `src/lib/slug.ts`, a plain module with no
directive. Tasks 8 and 9 and the Task 8 test import it from `@/lib/slug`.

### A2. Context-taking functions must not be Server Actions

As written, every `actions.ts` carries `'use server'` at the top *and* exports the
context-taking core functions (`createProject(ctx, input)`, `updateTask(ctx, input)`,
`inviteMember(ctx, input)`, and so on). Every export of a `'use server'` module is a
public HTTP endpoint. A client could therefore call these directly with a forged
context — `{ workspaceId: <any workspace>, role: 'owner' }` — and the function would
trust it, because spec §4 makes the context the sole carrier of tenancy. That is a
complete bypass of the boundary Task 7 exists to build, available to anyone holding
any session.

**Do this instead.** Every feature under `src/server/` is two files:

| file | directive | contains | imported by |
|---|---|---|---|
| `service.ts` | none | the context-taking functions, exactly as the task body writes them | server components, other services, tests |
| `actions.ts` | `'use server'` | **only** the slug-taking wrappers | client components only |

A wrapper is the whole of what `actions.ts` holds:

```ts
'use server';

import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createProject } from './service';

export async function createProjectAction(
  workspaceSlug: string,
  input: { name: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => createProject(await requireWorkspace(workspaceSlug), input));
}
```

Applies to `workspaces`, `projects`, `tasks`, `labels`, `members`, and `settings`.

Specific consequences:

- Task 8: `createWorkspaceForUser(userId, name)` goes in
  `src/server/workspaces/service.ts`. Only `createWorkspaceAction` stays in
  `actions.ts` — it derives the user from the session itself, which is allowed.
- Task 15: `acceptInvitation(userId, userEmail, invitationId)` goes in
  `src/server/members/service.ts`. As an action it would let any caller redeem an
  invitation as another user.
- Every test file imports the context-taking functions from `./service`, not
  `./actions`. The import lines in the task bodies change accordingly; nothing else
  about the tests changes.
- `queries.ts` files are unaffected — they never carried `'use server'`.

### Added Global Constraint

- **A `'use server'` module may export only functions that derive the caller's
  identity server-side** — that is, functions whose first parameter is a workspace
  slug, or which read the session themselves. A `'use server'` export taking a
  `WorkspaceContext`, a `userId`, or a `workspaceId` from its caller is a review
  rejection: it is a public endpoint trusting client-supplied authorization.

---

## File Structure

```
taskeeper/
  docker-compose.yml               local Postgres for dev + test
  drizzle.config.ts                drizzle-kit config
  vitest.config.ts                 node-env tests, TZ=UTC, global setup
  playwright.config.ts
  .env.example                     every var, no real values
  drizzle/                         generated SQL migrations (committed)
  src/
    app/
      layout.tsx                   html shell, fonts, ThemeProvider
      globals.css                  design tokens + @theme
      page.tsx                     root redirect
      (auth)/sign-in/page.tsx
      (auth)/sign-up/page.tsx
      (auth)/invite/[invitationId]/page.tsx
      (app)/[workspaceSlug]/layout.tsx          rail + header shell
      (app)/[workspaceSlug]/page.tsx            my open tasks
      (app)/[workspaceSlug]/projects/[projectId]/page.tsx        list view
      (app)/[workspaceSlug]/projects/[projectId]/board/page.tsx  board view
      (app)/[workspaceSlug]/settings/members/page.tsx
      (app)/[workspaceSlug]/settings/general/page.tsx            timezone
      api/auth/[...all]/route.ts
    db/
      index.ts                     drizzle client over pg Pool
      schema/{auth,project,task,settings,index}.ts
    lib/
      auth.ts                      better-auth server instance
      auth-client.ts               better-auth react client
      session.ts                   requireWorkspace, requireRole
      dates.ts                     timezone-aware date helpers
      position.ts                  fractional index helpers
      result.ts                    Result<T>, ok(), err(), withAction()
      ids.ts                       nanoid id factory
    server/
      projects/{queries.ts,actions.ts}
      tasks/{queries.ts,actions.ts}
      labels/{queries.ts,actions.ts}
      members/{queries.ts,actions.ts}
      settings/{queries.ts,actions.ts}
    components/
      ui/                          shadcn primitives
      shell/{Rail,WorkspaceSwitcher,ViewTabs,ThemeToggle}.tsx
      task/{TaskRow,TaskDetailPanel,PriorityPicker,LabelPicker,DueDateField}.tsx
      board/{Board,BoardColumn,TaskCard}.tsx
  tests/
    setup/{global-setup.ts,db.ts,factories.ts}
    unit/{dates.test.ts,position.test.ts}
    server/{tenancy.test.ts,projects.test.ts,tasks.test.ts,labels.test.ts,members.test.ts}
    e2e/{auth.spec.ts,board.spec.ts}
```

Files split by responsibility, not layer: a feature's queries, actions, and Zod schemas live together under `src/server/<feature>/`.

---

### Task 1: Project scaffold, database container, and test harness

Produces a repo where `yarn test` runs and connects to a real Postgres. Everything later depends on this.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`, `.env.example`, `.env.local`, `vitest.config.ts`, `tests/setup/db.ts`, `tests/unit/smoke.test.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `yarn test` (vitest), `yarn dev`, `yarn db:up`, `DATABASE_URL` / `DATABASE_URL_TEST` conventions.

- [ ] **Step 1: Activate Yarn 4 and configure the linker**

```bash
cd /home/levon/taskeeper
corepack enable
corepack use yarn@4.10.3
```

`corepack use` writes a `packageManager` field into `package.json` and downloads that exact
Yarn into `.yarn/releases/`. Both are committed, so every machine and CI runner resolves the
same Yarn without a global install.

Then write `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
enableGlobalCache: true
```

`node-modules` rather than PnP: Next.js's bundler and the shadcn CLI both still assume a real
`node_modules` tree.

And add to `.gitignore`:

```gitignore
.yarn/*
!.yarn/patches
!.yarn/releases
.pnp.*
```

- [ ] **Step 2: Scaffold the Next.js app**

```bash
yarn dlx create-next-app@16.3.5 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-yarn --yes
```

If the directory is not empty, answer yes to proceeding — `docs/`, `.git/`, `.yarn/`, and
`.yarnrc.yml` are expected to already exist and must not be deleted. If the scaffold
overwrites `package.json` and drops the `packageManager` field, re-run `corepack use yarn@4.10.3`.

- [ ] **Step 3: Pin versions and add dependencies**

```bash
yarn add --exact next@16.3.5 react@19.3.0 react-dom@19.3.0 \
  drizzle-orm@0.45.2 pg@8.23.0 better-auth@1.7.5 zod@4.6.5 \
  nanoid@5.1.6 fractional-indexing@3.2.0 next-themes@0.4.6 lucide-react@0.550.0 \
  @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 resend@6.2.0

yarn add --exact --dev drizzle-kit@0.31.10 @types/pg@8.23.1 vitest@4.1.0 \
  dotenv@17.2.3 tsx@4.20.7
```

`--exact` is what pins these; without it Yarn writes a `^` range and the Global Constraints
version floor stops being a floor.

If any exact version above no longer resolves, install the closest published version and note the substitution in the commit message — do not silently float to `latest`.

- [ ] **Step 4: Write `docker-compose.yml`**

Two databases in one container: the dev database and a separate test database, so running tests never destroys dev data.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: taskeeper-pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: taskeeper
      POSTGRES_PASSWORD: taskeeper
      POSTGRES_DB: taskeeper
      TZ: UTC
    ports:
      - "5433:5432"
    volumes:
      - taskeeper-pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U taskeeper -d taskeeper"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  taskeeper-pgdata:
```

Port 5433, not 5432, so it cannot collide with a Postgres already installed on the host.

- [ ] **Step 5: Write `scripts/init-test-db.sql`**

```sql
CREATE DATABASE taskeeper_test OWNER taskeeper;
```

- [ ] **Step 6: Write `.env.example` and `.env.local`**

`.env.example` is committed. `.env.local` is gitignored and holds the same values for local development.

```bash
# Postgres connection string. Against a pooled provider endpoint (PgBouncer) in production.
DATABASE_URL=postgres://taskeeper:taskeeper@localhost:5433/taskeeper
# Separate database used by the test suite; it is truncated between tests.
DATABASE_URL_TEST=postgres://taskeeper:taskeeper@localhost:5433/taskeeper_test
# Connection pool size. Lower toward 1 on serverless, raise on a long-running server.
DATABASE_POOL_MAX=10
# Session signing key. Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-me-with-openssl-rand-base64-32
# Public origin of the app.
BETTER_AUTH_URL=http://localhost:3000
# Invitation email delivery. Leave empty in development to log emails to the console.
RESEND_API_KEY=
# Pins the runtime clock so every timezone conversion goes through src/lib/dates.ts.
TZ=UTC
```

- [ ] **Step 7: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:up": "docker compose up -d --wait",
    "db:down": "docker compose down",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

Invoke these as `yarn dev`, `yarn test`, `yarn db:up` — Yarn runs a script by name with no
`run` keyword. `yarn drizzle-kit ...` and `yarn vitest ...` run the locally installed binaries
directly, which is Yarn's equivalent of `npx` for a dependency that is already installed.
`yarn dlx` is for packages that are not dependencies, such as the scaffolder and the shadcn CLI.

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup/env.ts'],
    // Tests share one database and truncate between cases, so they must not run
    // in parallel against each other.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 9: Write `tests/setup/env.ts`**

```ts
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.TZ = 'UTC';

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set. Copy .env.example to .env.local.');
}

// Every module that reads DATABASE_URL gets the test database during tests.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
```

- [ ] **Step 10: Write the failing smoke test**

This proves the harness runs and the container is reachable before any real code exists.

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

describe('test harness', () => {
  it('runs with the clock pinned to UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it('can reach the test database', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
      expect(rows[0].ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 11: Run the test with the database stopped, to verify it fails**

```bash
yarn db:down
yarn test
```

Expected: the UTC test passes, the database test FAILS with `ECONNREFUSED`. This confirms the test is actually reaching a database rather than passing vacuously.

- [ ] **Step 12: Start the database and re-run**

```bash
yarn db:up
yarn test
```

Expected: both tests PASS.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold next app, postgres container, and vitest harness"
```

---

### Task 2: Design tokens, fonts, and theme switching

Produces the visual foundation every later component depends on. No feature work is done here, but doing it now means no component is ever written against placeholder colors.

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/shell/ThemeToggle.tsx`, `src/components/theme-provider.tsx`
- Create: `src/app/fonts/` (Plus Jakarta Sans woff2 files)

**Interfaces:**
- Consumes: Task 1's scaffold.
- Produces: semantic Tailwind utilities `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, `bg-success`, `bg-destructive`, `ring-ring`; `<ThemeToggle />`.

- [ ] **Step 1: Download the font**

```bash
mkdir -p src/app/fonts
curl -L -o src/app/fonts/PlusJakartaSans-Variable.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans:vf@latest/latin-wght-normal.woff2"
```

Self-hosted rather than the Google Fonts CDN: no render-blocking third-party request and no layout shift (spec §6.2).

- [ ] **Step 2: Write `src/app/globals.css` with the token set**

Values are copied verbatim from spec §6.1. `@theme inline` is how Tailwind v4 turns CSS variables into utility classes.

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #F8FAFC;
  --card: #FFFFFF;
  --foreground: #0F172A;
  --muted: #F1F5F9;
  --muted-foreground: #64748B;
  --border: #E2E8F0;
  --primary: #2563EB;
  --primary-foreground: #FFFFFF;
  --success: #059669;
  --destructive: #DC2626;
  --ring: #2563EB;
  --radius-button: 6px;
  --radius-card: 8px;
  --radius-panel: 12px;
}

.dark {
  --background: #020617;
  --card: #0E1223;
  --foreground: #F8FAFC;
  --muted: #1A1E2F;
  --muted-foreground: #94A3B8;
  --border: #334155;
  --primary: #3B82F6;
  --primary-foreground: #0B1220;
  --success: #22C55E;
  --destructive: #EF4444;
  --ring: #3B82F6;
}

@theme inline {
  --color-background: var(--background);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-success: var(--success);
  --color-destructive: var(--destructive);
  --color-ring: var(--ring);
  --font-sans: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif;
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  line-height: 1.5;
}

/* Numeric columns must not jitter as values change (spec §6.2). */
.tabular {
  font-variant-numeric: tabular-nums;
}

/* Focus rings are never removed (Global Constraints). */
:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Write `src/components/theme-provider.tsx`**

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 4: Wire fonts and the provider in `src/app/layout.tsx`**

`suppressHydrationWarning` on `<html>` is required: `next-themes` writes the theme class before React hydrates, so the server and client markup differ by design on that one attribute.

```tsx
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const jakarta = localFont({
  src: './fonts/PlusJakartaSans-Variable.woff2',
  variable: '--font-jakarta',
  display: 'swap',
  weight: '200 800',
});

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Write `src/components/shell/ThemeToggle.tsx`**

```tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex size-11 items-center justify-center rounded-[var(--radius-button)] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
    >
      {/* Render a stable icon until mounted, so server and client markup match. */}
      {mounted && isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
```

The 44px (`size-11`) target meets the minimum touch size from the design guidelines.

- [ ] **Step 6: Verify both themes render**

```bash
yarn dev
```

Open `http://localhost:3000`, toggle the theme, and confirm: no flash of the wrong theme on reload, body text readable in both, focus ring visible when tabbing to the toggle. Then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: design tokens, self-hosted font, and theme switching"
```

---

### Task 3: Timezone-aware date helpers

Pure functions, no database. Built early because every later date decision depends on them, and because they are the spec's highest-risk correctness area (spec §3.4).

**Files:**
- Create: `src/lib/dates.ts`, `tests/unit/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `todayInZone(tz: string, now?: Date): string` — `'YYYY-MM-DD'`
  - `isOverdue(dueDate: string, tz: string, now?: Date): boolean`
  - `formatInZone(instant: Date, tz: string): string`
  - `formatDueDate(dueDate: string, tz: string, now?: Date): string`
  - `DEFAULT_TIMEZONE = 'Asia/Yerevan'`

- [ ] **Step 1: Write the failing tests**

The `now` parameter exists purely so these cases are testable without mocking global time.

```ts
// tests/unit/dates.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  formatDueDate,
  formatInZone,
  isOverdue,
  todayInZone,
} from '@/lib/dates';

const YEREVAN = 'Asia/Yerevan';

describe('todayInZone', () => {
  it('returns the calendar date in the given zone', () => {
    // 2026-09-20T10:00:00Z is 14:00 the same day in Yerevan (UTC+4).
    expect(todayInZone(YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('2026-09-20');
  });

  it('returns tomorrow in Yerevan when UTC is still on the previous evening', () => {
    // This is the bug the helper exists to prevent: 21:00 UTC is already 01:00
    // the next day in Yerevan, so the server clock's date is wrong by one day.
    expect(todayInZone(YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe('2026-09-21');
  });

  it('disagrees with the UTC date in that window', () => {
    const instant = new Date('2026-09-20T21:00:00Z');
    expect(todayInZone('UTC', instant)).toBe('2026-09-20');
    expect(todayInZone(YEREVAN, instant)).toBe('2026-09-21');
  });

  it('defaults to Asia/Yerevan', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Yerevan');
  });
});

describe('isOverdue', () => {
  it('is false for a task due today', () => {
    expect(isOverdue('2026-09-20', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe(false);
  });

  it('is false at 21:00 UTC for a task due on the Yerevan tomorrow', () => {
    expect(isOverdue('2026-09-21', YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe(false);
  });

  it('is true once the Yerevan day has passed', () => {
    expect(isOverdue('2026-09-20', YEREVAN, new Date('2026-09-20T21:00:00Z'))).toBe(true);
  });

  it('is true for a past date', () => {
    expect(isOverdue('2026-09-01', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe(true);
  });
});

describe('formatInZone', () => {
  it('renders an instant in the workspace zone, not UTC', () => {
    expect(formatInZone(new Date('2026-09-20T21:30:00Z'), YEREVAN)).toBe('21 Sep 2026, 01:30');
  });
});

describe('formatDueDate', () => {
  it('says Today for the current day in the zone', () => {
    expect(formatDueDate('2026-09-20', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('Today');
  });

  it('says Tomorrow for the next day in the zone', () => {
    expect(formatDueDate('2026-09-21', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('Tomorrow');
  });

  it('falls back to a short date otherwise', () => {
    expect(formatDueDate('2026-10-05', YEREVAN, new Date('2026-09-20T10:00:00Z'))).toBe('5 Oct');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn vitest run tests/unit/dates.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/dates"`.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

`Intl.DateTimeFormat` with `en-CA` is used because that locale's short date format is exactly `YYYY-MM-DD`, which avoids hand-assembling the string from parts.

```ts
export const DEFAULT_TIMEZONE = 'Asia/Yerevan';

/** The calendar date ('YYYY-MM-DD') in the given IANA zone at the given instant. */
export function todayInZone(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * A task is overdue once the workspace's calendar day has moved past its due date.
 * Compared as strings: 'YYYY-MM-DD' sorts lexicographically the same way it sorts
 * chronologically, so no Date parsing is needed and no zone can creep back in.
 */
export function isOverdue(dueDate: string, tz: string, now: Date = new Date()): boolean {
  return dueDate < todayInZone(tz, now);
}

/** Renders an instant (created_at, completed_at) in the workspace zone. */
export function formatInZone(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  // Date.UTC keeps this arithmetic in a fixed zone; the result is only ever
  // formatted back out as a calendar date, never treated as an instant.
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Human label for a due date, relative to today in the workspace zone. */
export function formatDueDate(dueDate: string, tz: string, now: Date = new Date()): string {
  const today = todayInZone(tz, now);
  if (dueDate === today) return 'Today';
  if (dueDate === addDays(today, 1)) return 'Tomorrow';
  if (dueDate === addDays(today, -1)) return 'Yesterday';

  const [y, m, d] = dueDate.split('-').map(Number);
  const asInstant = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(asInstant);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn vitest run tests/unit/dates.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts tests/unit/dates.test.ts
git commit -m "feat: timezone-aware date helpers with workspace zone support"
```

---

### Task 4: Fractional position helpers and id factory

Pure functions. Board ordering depends on these (spec §3.3).

**Files:**
- Create: `src/lib/position.ts`, `src/lib/ids.ts`, `tests/unit/position.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `positionBetween(before: string | null, after: string | null): string`
  - `positionsForCount(n: number): string[]`
  - `newId(): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/position.test.ts
import { describe, expect, it } from 'vitest';
import { positionBetween, positionsForCount } from '@/lib/position';
import { newId } from '@/lib/ids';

describe('positionBetween', () => {
  it('produces a key for an empty list', () => {
    const only = positionBetween(null, null);
    expect(typeof only).toBe('string');
    expect(only.length).toBeGreaterThan(0);
  });

  it('produces a key that sorts before an existing first item', () => {
    const first = positionBetween(null, null);
    expect(positionBetween(null, first) < first).toBe(true);
  });

  it('produces a key that sorts after an existing last item', () => {
    const last = positionBetween(null, null);
    expect(positionBetween(last, null) > last).toBe(true);
  });

  it('produces a key strictly between two neighbours', () => {
    const a = positionBetween(null, null);
    const b = positionBetween(a, null);
    const mid = positionBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('survives repeated insertion between the same two neighbours', () => {
    // Integer positions would collide here after one insert; fractional keys
    // must keep subdividing without ever producing a duplicate.
    let lo = positionBetween(null, null);
    const hi = positionBetween(lo, null);
    const seen = new Set([lo, hi]);
    for (let i = 0; i < 50; i++) {
      const mid = positionBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      lo = mid;
    }
  });
});

describe('positionsForCount', () => {
  it('returns n ascending keys', () => {
    const keys = positionsForCount(3);
    expect(keys).toHaveLength(3);
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns an empty array for zero', () => {
    expect(positionsForCount(0)).toEqual([]);
  });
});

describe('newId', () => {
  it('returns distinct url-safe ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn vitest run tests/unit/position.test.ts
```

Expected: FAIL — cannot resolve `@/lib/position`.

- [ ] **Step 3: Implement `src/lib/ids.ts`**

```ts
import { nanoid } from 'nanoid';

/** 21-character url-safe id. Used as the primary key for every application table. */
export function newId(): string {
  return nanoid();
}
```

- [ ] **Step 4: Implement `src/lib/position.ts`**

```ts
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * A sort key strictly between two neighbours. Pass null for "start of list" or
 * "end of list". Writing one row per move is the whole point: integer positions
 * would require renumbering every row after the insertion point (spec §3.3).
 */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** n ascending keys, for seeding a fresh list such as a project's default statuses. */
export function positionsForCount(n: number): string[] {
  if (n <= 0) return [];
  return generateNKeysBetween(null, null, n);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn vitest run tests/unit/position.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/position.ts src/lib/ids.ts tests/unit/position.test.ts
git commit -m "feat: fractional position helpers and id factory"
```

---

### Task 5: Database client, schema, and migrations

Produces the whole schema from spec §3 and a test harness that can create and truncate it.

**Files:**
- Create: `src/db/index.ts`, `src/db/schema/{auth,project,task,settings,index}.ts`, `drizzle.config.ts`, `tests/setup/db.ts`, `tests/server/schema.test.ts`
- Create: `drizzle/` (generated)

**Interfaces:**
- Consumes: `newId` (Task 4).
- Produces: `db` (Drizzle client), tables `user, session, account, verification, organization, member, invitation, project, taskStatus, task, label, taskLabel, workspaceSettings`, and `resetDb()` / `closeDb()` for tests.

- [ ] **Step 1: Write `src/db/index.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// One code path for every host. Against a pooled provider endpoint this pool sits
// in front of PgBouncer; on a long-running server it is an ordinary pool.
// Never a provider-specific driver (spec §7).
const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export const db = drizzle(pool, { schema });
export { pool };
export * from './schema';
```

- [ ] **Step 2: Write `src/db/schema/auth.ts`**

These tables mirror what better-auth's adapter expects. Do not hand-edit their columns later; regenerate if the plugin set changes (spec §3.1).

```ts
import { boolean, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  activeOrganizationId: text('active_organization_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('member_org_user_idx').on(t.organizationId, t.userId)],
);

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inviterId: text('inviter_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Write `src/db/schema/settings.ts`**

```ts
import { pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { organization } from './auth';

// Separate from `organization` because better-auth owns that table (spec §3.1).
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Asia/Yerevan'),
  weekStart: smallint('week_start').notNull().default(1),
});
```

- [ ] **Step 4: Write `src/db/schema/project.ts`**

```ts
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull().default('primary'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_workspace_slug_uq').on(t.workspaceId, t.slug),
    index('project_workspace_archived_idx').on(t.workspaceId, t.archivedAt),
  ],
);
```

- [ ] **Step 5: Write `src/db/schema/task.ts`**

```ts
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { project } from './project';

export const priorityEnum = pgEnum('task_priority', ['none', 'low', 'medium', 'high', 'urgent']);

export const taskStatus = pgTable(
  'task_status',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('muted'),
    position: text('position').notNull(),
    isDone: boolean('is_done').notNull().default(false),
  },
  (t) => [index('task_status_project_position_idx').on(t.projectId, t.position)],
);

export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // RESTRICT so a column holding tasks cannot be deleted. Project deletion runs
    // as an explicit transaction instead of relying on cascade ordering (spec §3.2).
    statusId: text('status_id').notNull().references(() => taskStatus.id, { onDelete: 'restrict' }),
    priority: priorityEnum('priority').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    // A bare date: "due the 21st" is a calendar day in the workspace zone, not an
    // instant (spec §3.4).
    dueDate: date('due_date'),
    position: text('position').notNull(),
    parentTaskId: text('parent_task_id').references((): any => task.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_board_idx').on(t.projectId, t.statusId, t.position),
    index('task_assignee_idx').on(t.workspaceId, t.assigneeId, t.archivedAt),
    index('task_parent_idx').on(t.parentTaskId),
  ],
);

export const label = pgTable(
  'label',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('muted'),
  },
  (t) => [uniqueIndex('label_workspace_name_uq').on(t.workspaceId, t.name)],
);

export const taskLabel = pgTable(
  'task_label',
  {
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    labelId: text('label_id').notNull().references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);
```

- [ ] **Step 6: Write `src/db/schema/index.ts`**

```ts
export * from './auth';
export * from './settings';
export * from './project';
export * from './task';
```

- [ ] **Step 7: Write `drizzle.config.ts`**

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 8: Generate and apply the migration**

```bash
yarn db:up
yarn db:generate
yarn db:migrate
```

Then apply the same migration to the test database:

```bash
DATABASE_URL="$DATABASE_URL_TEST" yarn drizzle-kit migrate
```

Expected: a new file under `drizzle/` and both databases holding all 13 tables.

- [ ] **Step 9: Write `tests/setup/db.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db, pool } from '@/db';

/**
 * Truncate every application table between tests. RESTART IDENTITY CASCADE in one
 * statement sidesteps foreign-key ordering entirely.
 */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      task_label, task, task_status, label, project,
      workspace_settings, invitation, member, organization,
      session, account, verification, "user"
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { db };
```

- [ ] **Step 10: Write the failing schema test**

```ts
// tests/server/schema.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { organization, project, task, taskStatus, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';

beforeEach(resetDb);
afterAll(closeDb);

async function seedProject() {
  const userId = newId();
  const workspaceId = newId();
  const projectId = newId();
  const statusId = newId();

  await db.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` });
  await db.insert(organization).values({ id: workspaceId, name: 'Acme', slug: workspaceId });
  await db.insert(project).values({
    id: projectId, workspaceId, name: 'Website', slug: 'website', createdBy: userId,
  });
  await db.insert(taskStatus).values({
    id: statusId, projectId, name: 'Todo', position: positionBetween(null, null),
  });

  return { userId, workspaceId, projectId, statusId };
}

describe('schema', () => {
  it('stores a task and reads it back', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();

    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    const rows = await db.select().from(task);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Ship v1');
    expect(rows[0].priority).toBe('none');
    expect(rows[0].description).toBe('');
  });

  it('keeps due_date as a calendar string with no zone shift', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();

    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Due task', statusId,
      dueDate: '2026-09-21', position: positionBetween(null, null), createdBy: userId,
    });

    const [row] = await db.select().from(task);
    // If due_date were a timestamp, this would come back as the 20th for a
    // UTC-negative reader. It must be the exact string that was written.
    expect(row.dueDate).toBe('2026-09-21');
  });

  it('refuses to delete a status that still holds tasks', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Blocker', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await expect(
      db.execute(sql`DELETE FROM task_status WHERE id = ${statusId}`),
    ).rejects.toThrow();
  });

  it('cascades tasks when the workspace is deleted', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Gone', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await db.execute(sql`DELETE FROM organization WHERE id = ${workspaceId}`);
    expect(await db.select().from(task)).toHaveLength(0);
  });
});
```

- [ ] **Step 11: Run the tests**

```bash
yarn vitest run tests/server/schema.test.ts
```

Expected: PASS, 4 tests. If the RESTRICT test passes without throwing, the foreign key in Step 5 is wrong — fix it and regenerate the migration before continuing.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: drizzle schema, migrations, and database test harness"
```

---

### Task 6: Authentication

Sign up, sign in, sign out, and the session cookie. No workspace logic yet.

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`
- Create: `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/app/(auth)/layout.tsx`
- Create: `src/components/ui/{button,input,label}.tsx`
- Create: `tests/server/auth.test.ts`

**Interfaces:**
- Consumes: `db` (Task 5).
- Produces: `auth` (better-auth server instance), `authClient` with `signUp`, `signIn`, `signOut`, `useSession`, and `organization` methods.

- [ ] **Step 1: Add shadcn/ui primitives**

```bash
yarn dlx shadcn@latest init --yes --base-color slate
yarn dlx shadcn@latest add button input label dialog dropdown-menu sheet select avatar badge sonner --yes
```

After this, open `src/app/globals.css` and confirm the token block from Task 2 is still intact — shadcn's init rewrites that file. If it replaced the tokens, restore them from git and keep only shadcn's additions.

- [ ] **Step 2: Write `src/lib/auth.ts`**

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  plugins: [
    organization(),
    // nextCookies must be last: it wraps the response so Server Actions can set
    // cookies. Any plugin after it would not have its cookies applied.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 3: Write `src/lib/auth-client.ts`**

```ts
'use client';

import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 4: Write the route handler**

```ts
// src/app/api/auth/[...all]/route.ts
import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { POST, GET } = toNextJsHandler(auth);
```

- [ ] **Step 5: Regenerate the schema and reconcile**

```bash
yarn dlx @better-auth/cli generate --config src/lib/auth.ts --output drizzle/better-auth-schema.ts -y
```

Compare the generated file against `src/db/schema/auth.ts` from Task 5. If better-auth expects a column the hand-written schema lacks, add it to `src/db/schema/auth.ts`, then:

```bash
yarn db:generate && yarn db:migrate
DATABASE_URL="$DATABASE_URL_TEST" yarn drizzle-kit migrate
```

Delete `drizzle/better-auth-schema.ts` afterwards — it is a comparison artifact, not source.

- [ ] **Step 6: Write the failing auth test**

```ts
// tests/server/auth.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { auth } from '@/lib/auth';
import { user } from '@/db';

beforeEach(resetDb);
afterAll(closeDb);

describe('auth', () => {
  it('creates a user on sign up', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse' },
    });

    const rows = await db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('ada@example.com');
  });

  it('rejects a password below the minimum length', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Ada', email: 'short@example.com', password: 'abc' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate email', async () => {
    const body = { name: 'Ada', email: 'dupe@example.com', password: 'correct-horse' };
    await auth.api.signUpEmail({ body });
    await expect(auth.api.signUpEmail({ body })).rejects.toThrow();
  });

  it('signs in with the correct password and issues a session', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'signin@example.com', password: 'correct-horse' },
    });

    const result = await auth.api.signInEmail({
      body: { email: 'signin@example.com', password: 'correct-horse' },
    });

    expect(result.user.email).toBe('signin@example.com');
    expect(result.token).toBeTruthy();
  });

  it('refuses the wrong password', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Ada', email: 'wrong@example.com', password: 'correct-horse' },
    });

    await expect(
      auth.api.signInEmail({ body: { email: 'wrong@example.com', password: 'wrong-pass' } }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run to verify, iterating on schema mismatches**

```bash
yarn vitest run tests/server/auth.test.ts
```

Expected on first run: FAIL. Column-mismatch errors here mean Step 5's reconciliation is incomplete — fix `src/db/schema/auth.ts`, regenerate, re-migrate, re-run. Do not move on until all 5 pass.

- [ ] **Step 8: Write `src/app/(auth)/layout.tsx`**

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 9: Write `src/app/(auth)/sign-up/page.tsx`**

Labels are visible, not placeholder-only. Errors render below their field. Inputs are 16px so iOS does not zoom on focus.

```tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signUp } from '@/lib/auth-client';

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const { error } = await signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error) {
      setError(error.message ?? 'Could not create your account. Try again.');
      setPending(false);
      return;
    }
    router.push('/');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-[var(--radius-panel)] border border-border bg-card p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start organising your team&apos;s work.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoComplete="name" className="h-11 text-base" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" className="h-11 text-base" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password" name="password" type="password" required minLength={8}
          autoComplete="new-password" aria-describedby="password-help"
          className="h-11 text-base"
        />
        <p id="password-help" className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 10: Write `src/app/(auth)/sign-in/page.tsx`**

Same structure, calling `signIn.email({ email, password })`, with heading "Sign in", `autoComplete="current-password"`, no name field, no password helper text, and the footer link pointing to `/sign-up` with the text "Create one".

- [ ] **Step 11: Verify by hand**

```bash
yarn dev
```

Sign up at `/sign-up`, confirm redirect, sign out via devtools cookie deletion, sign in at `/sign-in`. Confirm a wrong password shows the error below the button and does not clear the email field.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: email and password authentication with better-auth"
```

---

### Task 7: Workspace context and the tenancy boundary

The most important task in the plan. Every later query depends on `requireWorkspace`, and its negative tests are the proof that one workspace cannot read another.

**Files:**
- Create: `src/lib/session.ts`, `src/lib/result.ts`, `tests/setup/factories.ts`, `tests/server/tenancy.test.ts`

**Interfaces:**
- Consumes: `auth` (Task 6), `db` (Task 5).
- Produces:
  - `type WorkspaceContext = { userId: string; workspaceId: string; slug: string; role: WorkspaceRole; timezone: string }`
  - `type WorkspaceRole = 'owner' | 'admin' | 'member'`
  - `requireWorkspace(slug: string): Promise<WorkspaceContext>`
  - `requireRole(ctx: WorkspaceContext, ...roles: WorkspaceRole[]): void`
  - `resolveWorkspace(userId: string, slug: string): Promise<WorkspaceContext | null>` — the pure, testable core
  - `type Result<T>`, `ok(data)`, `err(message)`, `withAction(fn)`
  - `ForbiddenError`

- [ ] **Step 1: Write `src/lib/result.ts`**

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(error: string): Result<never> {
  return { ok: false, error };
}

/** Thrown by requireRole; converted to a Result by withAction. */
export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Wraps a Server Action body so nothing ever throws across the client boundary
 * (spec §5). Expected failures return their own message; anything unexpected is
 * logged server-side and returned as a generic message, so internal detail such
 * as SQL text never reaches the browser.
 */
export async function withAction<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    console.error('[action]', error);
    return err('Something went wrong. Please try again.');
  }
}
```

- [ ] **Step 2: Write the failing tenancy tests**

Each case asserts a *negative*: a member of workspace A must not be able to reach workspace B.

```ts
// tests/server/tenancy.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { ForbiddenError } from '@/lib/result';
import { requireRole, resolveWorkspace } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

describe('resolveWorkspace', () => {
  it('returns context for a member', async () => {
    const ada = await createUser('ada@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme');

    const ctx = await resolveWorkspace(ada.id, 'acme');

    expect(ctx).not.toBeNull();
    expect(ctx!.workspaceId).toBe(acme.id);
    expect(ctx!.userId).toBe(ada.id);
    expect(ctx!.role).toBe('owner');
  });

  it('carries the workspace timezone, defaulting to Asia/Yerevan', async () => {
    const ada = await createUser('tz@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-tz');

    const ctx = await resolveWorkspace(ada.id, 'acme-tz');
    expect(ctx!.timezone).toBe('Asia/Yerevan');
  });

  it('returns null for a non-member, not a different error', async () => {
    // Null rather than a "forbidden" signal: callers render 404, so an outsider
    // cannot distinguish "not yours" from "does not exist" and probe for slugs.
    const ada = await createUser('ada2@example.com');
    const bob = await createUser('bob@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-private');

    expect(await resolveWorkspace(bob.id, 'acme-private')).toBeNull();
  });

  it('returns null for a slug that does not exist', async () => {
    const ada = await createUser('ada3@example.com');
    expect(await resolveWorkspace(ada.id, 'no-such-workspace')).toBeNull();
  });

  it('returns null after a member is removed', async () => {
    const ada = await createUser('ada4@example.com');
    const bob = await createUser('bob2@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-removed');
    const membership = await joinWorkspace(bob.id, acme.id, 'member');

    expect(await resolveWorkspace(bob.id, 'acme-removed')).not.toBeNull();
    await membership.remove();
    expect(await resolveWorkspace(bob.id, 'acme-removed')).toBeNull();
  });

  it('gives each member their own role in the same workspace', async () => {
    const ada = await createUser('owner@example.com');
    const bob = await createUser('member@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-roles');
    await joinWorkspace(bob.id, acme.id, 'member');

    expect((await resolveWorkspace(ada.id, 'acme-roles'))!.role).toBe('owner');
    expect((await resolveWorkspace(bob.id, 'acme-roles'))!.role).toBe('member');
  });
});

describe('requireRole', () => {
  const ctx = {
    userId: 'u1', workspaceId: 'w1', slug: 'w', role: 'member' as const, timezone: 'Asia/Yerevan',
  };

  it('passes when the role matches', () => {
    expect(() => requireRole({ ...ctx, role: 'admin' }, 'owner', 'admin')).not.toThrow();
  });

  it('throws ForbiddenError when it does not', () => {
    expect(() => requireRole(ctx, 'owner', 'admin')).toThrow(ForbiddenError);
  });

  it('allows an owner everywhere an admin is allowed', () => {
    expect(() => requireRole({ ...ctx, role: 'owner' }, 'owner', 'admin')).not.toThrow();
  });
});
```

- [ ] **Step 3: Write `tests/setup/factories.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { member, organization, user, workspaceSettings } from '@/db';
import { newId } from '@/lib/ids';

export async function createUser(email: string, name = 'Test User') {
  const id = newId();
  await db.insert(user).values({ id, name, email });
  return { id, email, name };
}

export async function createWorkspace(ownerId: string, name: string, slug: string) {
  const id = newId();
  await db.insert(organization).values({ id, name, slug });
  await db.insert(workspaceSettings).values({ workspaceId: id });
  await db.insert(member).values({ id: newId(), organizationId: id, userId: ownerId, role: 'owner' });
  return { id, name, slug };
}

export async function joinWorkspace(userId: string, workspaceId: string, role: 'admin' | 'member') {
  const id = newId();
  await db.insert(member).values({ id, organizationId: workspaceId, userId, role });
  return {
    id,
    async remove() {
      await db.delete(member).where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)));
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
yarn vitest run tests/server/tenancy.test.ts
```

Expected: FAIL — cannot resolve `@/lib/session`.

- [ ] **Step 5: Implement `src/lib/session.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { db, member, organization, workspaceSettings } from '@/db';
import { auth } from '@/lib/auth';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { ForbiddenError } from '@/lib/result';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  slug: string;
  role: WorkspaceRole;
  timezone: string;
};

/**
 * The tenant-isolation core, kept free of Next.js request APIs so it can be
 * tested directly. Resolution is by URL slug plus a membership row — never from
 * the session's active organization, so two tabs on two workspaces both work.
 */
export async function resolveWorkspace(
  userId: string,
  slug: string,
): Promise<WorkspaceContext | null> {
  const [row] = await db
    .select({
      workspaceId: organization.id,
      slug: organization.slug,
      role: member.role,
      timezone: workspaceSettings.timezone,
    })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, userId)),
    )
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(eq(organization.slug, slug))
    .limit(1);

  if (!row) return null;

  return {
    userId,
    workspaceId: row.workspaceId,
    slug: row.slug,
    role: row.role as WorkspaceRole,
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
  };
}

/** Server-component and action entry point. Redirects or 404s rather than returning null. */
export async function requireWorkspace(slug: string): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const ctx = await resolveWorkspace(session.user.id, slug);
  // 404, not 403: a non-member must not be able to learn which slugs exist.
  if (!ctx) notFound();

  return ctx;
}

export function requireRole(ctx: WorkspaceContext, ...roles: WorkspaceRole[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
yarn vitest run tests/server/tenancy.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: workspace context resolution and tenancy boundary"
```

---

### Task 8: Workspace creation and post-signup routing

Turns a bare authenticated user into someone standing inside a workspace. Closes the loop on the "first task in under 60 seconds" success criterion (spec §1).

**Files:**
- Create: `src/server/workspaces/{queries.ts,actions.ts}`, `src/app/(app)/new-workspace/page.tsx`
- Modify: `src/app/page.tsx`
- Create: `tests/server/workspaces.test.ts`

**Interfaces:**
- Consumes: `requireWorkspace`, `Result` (Task 7); `newId` (Task 4).
- Produces:
  - `listMyWorkspaces(userId: string): Promise<WorkspaceSummary[]>` where `WorkspaceSummary = { id: string; name: string; slug: string; role: WorkspaceRole }`
  - `createWorkspaceAction(input: { name: string }): Promise<Result<{ slug: string }>>`
  - `slugify(name: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/workspaces.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { listMyWorkspaces } from '@/server/workspaces/queries';
import { createWorkspaceForUser, slugify } from '@/server/workspaces/actions';
import { member, workspaceSettings } from '@/db';
import { eq } from 'drizzle-orm';

beforeEach(resetDb);
afterAll(closeDb);

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify("Ada's  Team!!")).toBe('adas-team');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -- Hello --  ')).toBe('hello');
  });

  it('falls back to "workspace" when nothing survives', () => {
    expect(slugify('!!!')).toBe('workspace');
  });
});

describe('createWorkspaceForUser', () => {
  it('creates the workspace, its settings row, and an owner membership', async () => {
    const ada = await createUser('ada@example.com');

    const created = await createWorkspaceForUser(ada.id, 'Acme Corp');

    expect(created.slug).toBe('acme-corp');

    const [settings] = await db
      .select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, created.id));
    expect(settings.timezone).toBe('Asia/Yerevan');
    expect(settings.weekStart).toBe(1);

    const [membership] = await db
      .select().from(member).where(eq(member.organizationId, created.id));
    expect(membership.userId).toBe(ada.id);
    expect(membership.role).toBe('owner');
  });

  it('disambiguates a slug that is already taken', async () => {
    const ada = await createUser('ada2@example.com');
    const bob = await createUser('bob@example.com');
    await createWorkspaceForUser(ada.id, 'Acme');

    const second = await createWorkspaceForUser(bob.id, 'Acme');

    expect(second.slug).not.toBe('acme');
    expect(second.slug.startsWith('acme-')).toBe(true);
  });
});

describe('listMyWorkspaces', () => {
  it('returns only workspaces the user belongs to', async () => {
    const ada = await createUser('ada3@example.com');
    const bob = await createUser('bob2@example.com');
    await createWorkspace(ada.id, 'Ada Co', 'ada-co');
    await createWorkspace(bob.id, 'Bob Co', 'bob-co');

    const mine = await listMyWorkspaces(ada.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].slug).toBe('ada-co');
    expect(mine[0].role).toBe('owner');
  });

  it('returns an empty array for a user with none', async () => {
    const carol = await createUser('carol@example.com');
    expect(await listMyWorkspaces(carol.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn vitest run tests/server/workspaces.test.ts
```

Expected: FAIL — cannot resolve `@/server/workspaces/queries`.

- [ ] **Step 3: Implement `src/server/workspaces/queries.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db, member, organization } from '@/db';
import type { WorkspaceRole } from '@/lib/session';

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

/**
 * Takes a userId rather than a WorkspaceContext: this is the one query that runs
 * before any workspace is chosen, so there is no context to pass yet.
 */
export async function listMyWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);

  return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }));
}
```

- [ ] **Step 4: Implement `src/server/workspaces/actions.ts`**

```ts
'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db, member, organization, workspaceSettings } from '@/db';
import { auth } from '@/lib/auth';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

async function uniqueSlug(base: string): Promise<string> {
  const [taken] = await db
    .select({ id: organization.id }).from(organization).where(eq(organization.slug, base)).limit(1);
  if (!taken) return base;
  // Suffix rather than a counter: a counter would need a second round-trip per
  // attempt under concurrent creation.
  return `${base}-${newId().slice(0, 6).toLowerCase()}`;
}

/** Exported separately from the action so tests can call it without a request. */
export async function createWorkspaceForUser(userId: string, name: string) {
  const id = newId();
  const slug = await uniqueSlug(slugify(name));

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id, name: name.trim(), slug });
    await tx.insert(workspaceSettings).values({ workspaceId: id });
    await tx.insert(member).values({
      id: newId(), organizationId: id, userId, role: 'owner',
    });
  });

  return { id, slug };
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name your workspace.').max(64, 'Keep it under 64 characters.'),
});

export async function createWorkspaceAction(
  input: { name: string },
): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return err('You need to sign in first.');

    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const { slug } = await createWorkspaceForUser(session.user.id, parsed.data.name);
    return ok({ slug });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn vitest run tests/server/workspaces.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Implement the root redirect in `src/app/page.tsx`**

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function RootPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const workspaces = await listMyWorkspaces(session.user.id);
  if (workspaces.length === 0) redirect('/new-workspace');

  redirect(`/${workspaces[0].slug}`);
}
```

- [ ] **Step 7: Write `src/app/(app)/new-workspace/page.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkspaceAction } from '@/server/workspaces/actions';

export default function NewWorkspacePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const name = String(new FormData(event.currentTarget).get('name'));
    const result = await createWorkspaceAction({ name });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/${result.data.slug}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-[var(--radius-panel)] border border-border bg-card p-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Create a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A workspace holds your projects and your team.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="name">Workspace name</Label>
          <Input id="name" name="name" required maxLength={64} autoFocus className="h-11 text-base" />
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Verify the full path by hand**

```bash
yarn dev
```

Sign up as a brand new user. Expected: redirected to `/new-workspace`, then after submitting to `/<slug>`, which 404s for now — that is correct, Task 10 builds it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: workspace creation and post-signup routing"
```

---

### Task 9: Projects — queries, actions, and default statuses

**Files:**
- Create: `src/server/projects/{queries.ts,actions.ts}`, `tests/server/projects.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext`, `requireRole`, `Result` (Task 7); `positionsForCount`, `newId` (Task 4).
- Produces:
  - `listProjects(ctx): Promise<ProjectSummary[]>` where `ProjectSummary = { id, name, slug, color, openTaskCount: number }`
  - `getProject(ctx, projectId): Promise<ProjectDetail | null>` where `ProjectDetail = { id, name, slug, color, statuses: StatusRow[] }`
  - `StatusRow = { id: string; name: string; color: string; position: string; isDone: boolean }`
  - `createProject(ctx, input): Promise<Result<{ id: string }>>`
  - `renameProject(ctx, input): Promise<Result<null>>`
  - `archiveProject(ctx, input): Promise<Result<null>>`
  - `deleteProject(ctx, input): Promise<Result<null>>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/projects.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { getProject, listProjects } from '@/server/projects/queries';
import { archiveProject, createProject, deleteProject } from '@/server/projects/actions';
import { task, taskStatus } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function ctxFor(email: string, slug: string): Promise<WorkspaceContext> {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  return {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
}

describe('createProject', () => {
  it('creates a project with three default statuses in order', async () => {
    const ctx = await ctxFor('ada@example.com', 'acme');

    const result = await createProject(ctx, { name: 'Website' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const statuses = await db
      .select().from(taskStatus)
      .where(eq(taskStatus.projectId, result.data.id))
      .orderBy(taskStatus.position);

    expect(statuses.map((s) => s.name)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(statuses.map((s) => s.isDone)).toEqual([false, false, true]);
  });

  it('rejects an empty name', async () => {
    const ctx = await ctxFor('ada2@example.com', 'acme2');
    const result = await createProject(ctx, { name: '   ' });
    expect(result.ok).toBe(false);
  });

  it('disambiguates a duplicate slug within the workspace', async () => {
    const ctx = await ctxFor('ada3@example.com', 'acme3');
    await createProject(ctx, { name: 'Website' });
    const second = await createProject(ctx, { name: 'Website' });

    expect(second.ok).toBe(true);
    const projects = await listProjects(ctx);
    expect(new Set(projects.map((p) => p.slug)).size).toBe(2);
  });

  it('allows the same project name in two different workspaces', async () => {
    const a = await ctxFor('a@example.com', 'ws-a');
    const b = await ctxFor('b@example.com', 'ws-b');

    expect((await createProject(a, { name: 'Website' })).ok).toBe(true);
    expect((await createProject(b, { name: 'Website' })).ok).toBe(true);
  });
});

describe('listProjects', () => {
  it('returns only this workspace’s projects', async () => {
    const a = await ctxFor('a2@example.com', 'ws-a2');
    const b = await ctxFor('b2@example.com', 'ws-b2');
    await createProject(a, { name: 'Ada Project' });
    await createProject(b, { name: 'Bob Project' });

    const forA = await listProjects(a);
    expect(forA).toHaveLength(1);
    expect(forA[0].name).toBe('Ada Project');
  });

  it('excludes archived projects', async () => {
    const ctx = await ctxFor('ada4@example.com', 'acme4');
    const created = await createProject(ctx, { name: 'Old' });
    if (!created.ok) throw new Error('setup failed');

    await archiveProject(ctx, { projectId: created.data.id });
    expect(await listProjects(ctx)).toHaveLength(0);
  });
});

describe('getProject', () => {
  it('returns null for a project in another workspace', async () => {
    const a = await ctxFor('a3@example.com', 'ws-a3');
    const b = await ctxFor('b3@example.com', 'ws-b3');
    const created = await createProject(b, { name: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    // The id is correct and exists; only the workspace differs. This is the
    // cross-tenant read the whole boundary exists to stop.
    expect(await getProject(a, created.data.id)).toBeNull();
  });
});

describe('deleteProject', () => {
  it('refuses when the caller is a plain member', async () => {
    const ctx = await ctxFor('ada5@example.com', 'acme5');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');

    const asMember = { ...ctx, role: 'member' as const };
    const result = await deleteProject(asMember, { projectId: created.data.id });
    expect(result.ok).toBe(false);
  });

  it('deletes tasks then statuses then the project without tripping RESTRICT', async () => {
    const ctx = await ctxFor('ada6@example.com', 'acme6');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');

    const detail = await getProject(ctx, created.data.id);
    await db.insert(task).values({
      id: 'task-to-delete', workspaceId: ctx.workspaceId, projectId: created.data.id,
      title: 'Doomed', statusId: detail!.statuses[0].id, position: 'a0', createdBy: ctx.userId,
    });

    const result = await deleteProject(ctx, { projectId: created.data.id });

    expect(result.ok).toBe(true);
    expect(await db.select().from(task)).toHaveLength(0);
    expect(await db.select().from(taskStatus)).toHaveLength(0);
  });

  it('refuses to delete a project in another workspace', async () => {
    const a = await ctxFor('a4@example.com', 'ws-a4');
    const b = await ctxFor('b4@example.com', 'ws-b4');
    const created = await createProject(b, { name: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    const result = await deleteProject(a, { projectId: created.data.id });
    expect(result.ok).toBe(false);
    expect(await db.select().from(taskStatus)).not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn vitest run tests/server/projects.test.ts
```

Expected: FAIL — cannot resolve `@/server/projects/queries`.

- [ ] **Step 3: Implement `src/server/projects/queries.ts`**

```ts
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { db, project, task, taskStatus } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  color: string;
  openTaskCount: number;
};

export type StatusRow = {
  id: string;
  name: string;
  color: string;
  position: string;
  isDone: boolean;
};

export type ProjectDetail = {
  id: string;
  name: string;
  slug: string;
  color: string;
  statuses: StatusRow[];
};

export async function listProjects(ctx: WorkspaceContext): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      color: project.color,
      openTaskCount: count(task.id),
    })
    .from(project)
    .leftJoin(
      task,
      and(eq(task.projectId, project.id), isNull(task.archivedAt), isNull(task.completedAt)),
    )
    .where(and(eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt)))
    .groupBy(project.id)
    .orderBy(asc(project.name));

  return rows;
}

export async function getProject(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ProjectDetail | null> {
  const [row] = await db
    .select({ id: project.id, name: project.name, slug: project.slug, color: project.color })
    .from(project)
    // Both conditions, always: the id alone would read across tenants.
    .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);

  if (!row) return null;

  const statuses = await db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone,
    })
    .from(taskStatus)
    .where(eq(taskStatus.projectId, projectId))
    .orderBy(asc(taskStatus.position));

  return { ...row, statuses };
}
```

- [ ] **Step 4: Implement `src/server/projects/actions.ts`**

```ts
'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { positionsForCount } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, type WorkspaceContext } from '@/lib/session';
import { slugify } from '@/server/workspaces/actions';

const DEFAULT_STATUSES = [
  { name: 'Todo', color: 'muted', isDone: false },
  { name: 'In Progress', color: 'primary', isDone: false },
  { name: 'Done', color: 'success', isDone: true },
];

const nameSchema = z
  .string().trim().min(1, 'Name your project.').max(64, 'Keep it under 64 characters.');

async function uniqueProjectSlug(workspaceId: string, base: string): Promise<string> {
  const [taken] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, base)))
    .limit(1);
  return taken ? `${base}-${newId().slice(0, 6).toLowerCase()}` : base;
}

export async function createProject(
  ctx: WorkspaceContext,
  input: { name: string; color?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = z.object({ name: nameSchema, color: z.string().optional() }).safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const id = newId();
    const slug = await uniqueProjectSlug(ctx.workspaceId, slugify(parsed.data.name));
    const positions = positionsForCount(DEFAULT_STATUSES.length);

    await db.transaction(async (tx) => {
      await tx.insert(project).values({
        id, workspaceId: ctx.workspaceId, name: parsed.data.name, slug,
        color: parsed.data.color ?? 'primary', createdBy: ctx.userId,
      });
      await tx.insert(taskStatus).values(
        DEFAULT_STATUSES.map((s, i) => ({
          id: newId(), projectId: id, name: s.name, color: s.color,
          position: positions[i], isDone: s.isDone,
        })),
      );
    });

    revalidatePath(`/${ctx.slug}`);
    return ok({ id });
  });
}

export async function renameProject(
  ctx: WorkspaceContext,
  input: { projectId: string; name: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z.object({ projectId: z.string(), name: nameSchema }).safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const updated = await db
      .update(project)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .returning({ id: project.id });

    if (updated.length === 0) return err('Project not found.');

    revalidatePath(`/${ctx.slug}`);
    return ok(null);
  });
}

export async function archiveProject(
  ctx: WorkspaceContext,
  input: { projectId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const updated = await db
      .update(project)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .returning({ id: project.id });

    if (updated.length === 0) return err('Project not found.');

    revalidatePath(`/${ctx.slug}`);
    return ok(null);
  });
}

export async function deleteProject(
  ctx: WorkspaceContext,
  input: { projectId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .limit(1);

    if (!owned) return err('Project not found.');

    // Explicit order. task.status_id is RESTRICT, and relying on cascade would
    // leave the delete order between task and task_status undefined (spec §3.2).
    await db.transaction(async (tx) => {
      await tx.delete(task).where(eq(task.projectId, input.projectId));
      await tx.delete(taskStatus).where(eq(taskStatus.projectId, input.projectId));
      await tx.delete(project).where(eq(project.id, input.projectId));
    });

    revalidatePath(`/${ctx.slug}`);
    return ok(null);
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn vitest run tests/server/projects.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: project queries and actions with seeded default statuses"
```

---

### Task 10: Application shell

The rail, workspace switcher, and project navigation. First screen a signed-in user actually sees.

**Files:**
- Create: `src/app/(app)/[workspaceSlug]/layout.tsx`, `src/app/(app)/[workspaceSlug]/page.tsx`
- Create: `src/components/shell/{Rail,WorkspaceSwitcher,NewProjectDialog}.tsx`

**Interfaces:**
- Consumes: `requireWorkspace` (Task 7), `listProjects`/`createProject` (Task 9), `listMyWorkspaces` (Task 8), `ThemeToggle` (Task 2).
- Produces: the `[workspaceSlug]` route segment every later page nests inside.

- [ ] **Step 1: Write `src/app/(app)/[workspaceSlug]/layout.tsx`**

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Rail } from '@/components/shell/Rail';
import { auth } from '@/lib/auth';
import { requireWorkspace } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';
import { listMyWorkspaces } from '@/server/workspaces/queries';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const ctx = await requireWorkspace(workspaceSlug);
  const [projects, workspaces] = await Promise.all([
    listProjects(ctx),
    listMyWorkspaces(ctx.userId),
  ]);

  return (
    <div className="flex min-h-dvh bg-background">
      <Rail
        workspaceSlug={ctx.slug}
        workspaces={workspaces}
        projects={projects}
        userName={session.user.name}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/shell/Rail.tsx`**

The active project is marked by weight plus a left indicator bar, never by color alone. Below 1024px the rail becomes a Sheet.

```tsx
'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Menu, Settings } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { NewProjectDialog } from '@/components/shell/NewProjectDialog';
import type { ProjectSummary } from '@/server/projects/queries';
import type { WorkspaceSummary } from '@/server/workspaces/queries';

type Props = {
  workspaceSlug: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  userName: string;
};

function RailBody({ workspaceSlug, workspaces, projects }: Props) {
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();

  return (
    <nav aria-label="Workspace" className="flex h-full w-64 flex-col gap-4 border-r border-border bg-card p-3">
      <WorkspaceSwitcher current={workspaceSlug} workspaces={workspaces} />

      <div className="flex-1 space-y-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Projects
          </span>
          <NewProjectDialog workspaceSlug={workspaceSlug} />
        </div>

        {projects.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
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
                className={`flex items-center gap-2 rounded-[var(--radius-button)] border-l-2 px-2 py-2 text-sm transition-colors duration-150 ${
                  active
                    ? 'border-l-primary bg-muted font-semibold text-foreground'
                    : 'border-l-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span className="truncate">{project.name}</span>
                {project.openTaskCount > 0 && (
                  <span className="tabular ml-auto text-xs text-muted-foreground">
                    {project.openTaskCount}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border pt-3">
        <Link
          href={`/${workspaceSlug}/settings/members`}
          aria-current={pathname.includes('/settings') ? 'page' : undefined}
          className="flex h-11 flex-1 items-center gap-2 rounded-[var(--radius-button)] px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4" aria-hidden="true" />
          Settings
        </Link>
        <ThemeToggle />
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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Open navigation"
          className="fixed left-3 top-3 z-40 inline-flex size-11 items-center justify-center rounded-[var(--radius-button)] border border-border bg-card text-foreground lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <RailBody {...props} />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

- [ ] **Step 3: Write `src/components/shell/WorkspaceSwitcher.tsx`**

```tsx
'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorkspaceSummary } from '@/server/workspaces/queries';

export function WorkspaceSwitcher({
  current, workspaces,
}: { current: string; workspaces: WorkspaceSummary[] }) {
  const router = useRouter();
  const active = workspaces.find((w) => w.slug === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full items-center justify-between rounded-[var(--radius-button)] px-2 text-left text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-muted">
        <span className="truncate">{active?.name ?? 'Workspace'}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => router.push(`/${workspace.slug}`)}>
            <Check
              className={`size-4 ${workspace.slug === current ? 'opacity-100' : 'opacity-0'}`}
              aria-hidden="true"
            />
            <span className="truncate">{workspace.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/new-workspace')}>
          <Plus className="size-4" aria-hidden="true" />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Write `src/components/shell/NewProjectDialog.tsx`**

Server Actions need the `WorkspaceContext`, which only exists server-side, so this calls a thin route-aware wrapper. Add that wrapper to `src/server/projects/actions.ts`:

```ts
/** Slug-taking wrapper so client components can call the action without a context. */
export async function createProjectAction(
  workspaceSlug: string,
  input: { name: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const ctx = await requireWorkspace(workspaceSlug);
    return createProject(ctx, input);
  });
}
```

Add `import { requireWorkspace } from '@/lib/session';` to that file's imports. Then the dialog:

```tsx
'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="New project"
        className="inline-flex size-8 items-center justify-center rounded-[var(--radius-button)] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          It starts with three columns: Todo, In Progress, and Done.
        </DialogDescription>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input id="project-name" name="name" required maxLength={64} autoFocus className="h-11 text-base" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-11 w-full">
            {pending ? 'Creating…' : 'Create project'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the workspace home page**

```tsx
// src/app/(app)/[workspaceSlug]/page.tsx
import { requireWorkspace } from '@/lib/session';
import { listProjects } from '@/server/projects/queries';

export default async function WorkspaceHome({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const projects = await listProjects(ctx);

  return (
    <main className="p-6 lg:p-8">
      <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {projects.length === 0
          ? 'Create your first project from the sidebar to get started.'
          : `${projects.length} active ${projects.length === 1 ? 'project' : 'projects'}.`}
      </p>
    </main>
  );
}
```

Task 11 replaces the body of this page with the assigned-task list once tasks exist.

- [ ] **Step 6: Verify by hand**

```bash
yarn dev
```

Confirm: the rail renders; creating a project navigates to its (still 404) page and the project appears in the rail; visiting another user's workspace slug directly returns 404, not a redirect or an error page revealing the workspace exists; at 375px width the rail is a drawer and there is no horizontal page scroll.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: application shell with rail, workspace switcher, and project creation"
```

---

### Task 11: Tasks — queries and actions

The core data layer. Includes the board move, whose correctness the whole drag interaction rests on.

**Files:**
- Create: `src/server/tasks/{queries.ts,actions.ts}`, `tests/server/tasks.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext` (Task 7), `positionBetween` (Task 4), `todayInZone`/`isOverdue` (Task 3), `getProject` (Task 9).
- Produces:
  - `TaskRow = { id, title, description, statusId, priority, assigneeId, assigneeName, dueDate, position, completedAt, labels: LabelRow[], subtaskCount, subtaskDoneCount }`
  - `LabelRow = { id: string; name: string; color: string }`
  - `Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent'`
  - `listProjectTasks(ctx, projectId): Promise<TaskRow[]>`
  - `getTask(ctx, taskId): Promise<TaskRow | null>`
  - `listMyOpenTasks(ctx): Promise<(TaskRow & { projectId: string; projectName: string; overdue: boolean })[]>`
  - `createTask(ctx, input): Promise<Result<{ id: string }>>`
  - `updateTask(ctx, input): Promise<Result<null>>`
  - `moveTask(ctx, input): Promise<Result<{ position: string }>>`
  - `deleteTask(ctx, input): Promise<Result<null>>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/tasks.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/actions';
import { getProject } from '@/server/projects/queries';
import { createTask, deleteTask, moveTask, updateTask } from '@/server/tasks/actions';
import { getTask, listMyOpenTasks, listProjectTasks } from '@/server/tasks/queries';
import { task } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, created.data.id);
  return { ctx, projectId: created.data.id, statuses: detail!.statuses };
}

describe('createTask', () => {
  it('creates a task in the first status by default', async () => {
    const { ctx, projectId, statuses } = await setup('ada@example.com', 'acme');

    const result = await createTask(ctx, { projectId, title: 'Ship v1' });

    expect(result.ok).toBe(true);
    const tasks = await listProjectTasks(ctx, projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ship v1');
    expect(tasks[0].statusId).toBe(statuses[0].id);
    expect(tasks[0].priority).toBe('none');
  });

  it('stamps workspace_id from the context, never from the caller', async () => {
    const { ctx, projectId } = await setup('ada2@example.com', 'acme2');
    const other = await setup('bob@example.com', 'bob-ws');

    // A caller trying to smuggle in another workspace's id must be ignored.
    await createTask(ctx, { projectId, title: 'Smuggled', workspaceId: other.ctx.workspaceId } as never);

    const [row] = await db.select().from(task);
    expect(row.workspaceId).toBe(ctx.workspaceId);
  });

  it('rejects an empty title', async () => {
    const { ctx, projectId } = await setup('ada3@example.com', 'acme3');
    expect((await createTask(ctx, { projectId, title: '  ' })).ok).toBe(false);
  });

  it('refuses to create in another workspace’s project', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    const result = await createTask(a.ctx, { projectId: b.projectId, title: 'Trespass' });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(0);
  });

  it('appends each new task after the previous one', async () => {
    const { ctx, projectId } = await setup('ada4@example.com', 'acme4');
    await createTask(ctx, { projectId, title: 'First' });
    await createTask(ctx, { projectId, title: 'Second' });

    const tasks = await listProjectTasks(ctx, projectId);
    expect(tasks.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(tasks[0].position < tasks[1].position).toBe(true);
  });
});

describe('updateTask', () => {
  it('sets completed_at when moved to a done status', async () => {
    const { ctx, projectId, statuses } = await setup('ada5@example.com', 'acme5');
    const created = await createTask(ctx, { projectId, title: 'Finish me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: created.data.id, statusId: done.id });

    const after = await getTask(ctx, created.data.id);
    expect(after!.completedAt).not.toBeNull();
  });

  it('clears completed_at when moved back out of a done status', async () => {
    const { ctx, projectId, statuses } = await setup('ada6@example.com', 'acme6');
    const created = await createTask(ctx, { projectId, title: 'Reopen me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: created.data.id, statusId: done.id });
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[0].id });

    const after = await getTask(ctx, created.data.id);
    expect(after!.completedAt).toBeNull();
  });

  it('stores a due date as the exact calendar string given', async () => {
    const { ctx, projectId } = await setup('ada7@example.com', 'acme7');
    const created = await createTask(ctx, { projectId, title: 'Due' });
    if (!created.ok) throw new Error('setup failed');

    await updateTask(ctx, { taskId: created.data.id, dueDate: '2026-09-21' });

    expect((await getTask(ctx, created.data.id))!.dueDate).toBe('2026-09-21');
  });

  it('refuses to update a task in another workspace', async () => {
    const a = await setup('a2@example.com', 'ws-a2');
    const b = await setup('b2@example.com', 'ws-b2');
    const created = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(a.ctx, { taskId: created.data.id, title: 'Hijacked' });

    expect(result.ok).toBe(false);
    expect((await getTask(b.ctx, created.data.id))!.title).toBe('Theirs');
  });

  it('refuses a status that belongs to a different project', async () => {
    const { ctx, projectId } = await setup('ada8@example.com', 'acme8');
    const otherProject = await createProject(ctx, { name: 'Other' });
    if (!otherProject.ok) throw new Error('setup failed');
    const otherDetail = await getProject(ctx, otherProject.data.id);

    const created = await createTask(ctx, { projectId, title: 'Task' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(ctx, {
      taskId: created.data.id, statusId: otherDetail!.statuses[0].id,
    });
    expect(result.ok).toBe(false);
  });
});

describe('moveTask', () => {
  it('places a task between two neighbours in the target column', async () => {
    const { ctx, projectId, statuses } = await setup('ada9@example.com', 'acme9');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    // Move C between A and B.
    const result = await moveTask(ctx, {
      taskId: c.data.id, statusId: statuses[0].id,
      beforeId: a.data.id, afterId: b.data.id,
    });

    expect(result.ok).toBe(true);
    const ordered = await listProjectTasks(ctx, projectId);
    expect(ordered.map((t) => t.title)).toEqual(['A', 'C', 'B']);
  });

  it('moves a task to another column and marks it complete when that column is done', async () => {
    const { ctx, projectId, statuses } = await setup('ada10@example.com', 'acme10');
    const created = await createTask(ctx, { projectId, title: 'Move me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await moveTask(ctx, {
      taskId: created.data.id, statusId: done.id, beforeId: null, afterId: null,
    });

    const after = await getTask(ctx, created.data.id);
    expect(after!.statusId).toBe(done.id);
    expect(after!.completedAt).not.toBeNull();
  });

  it('survives repeated drops into the same gap', async () => {
    const { ctx, projectId, statuses } = await setup('ada11@example.com', 'acme11');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    for (let i = 0; i < 20; i++) {
      const result = await moveTask(ctx, {
        taskId: c.data.id, statusId: statuses[0].id,
        beforeId: a.data.id, afterId: b.data.id,
      });
      expect(result.ok).toBe(true);
    }

    const ordered = await listProjectTasks(ctx, projectId);
    expect(ordered.map((t) => t.title)).toEqual(['A', 'C', 'B']);
  });

  it('refuses to move a task into another workspace’s column', async () => {
    const a = await setup('a3@example.com', 'ws-a3');
    const b = await setup('b3@example.com', 'ws-b3');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Mine' });
    if (!created.ok) throw new Error('setup failed');

    const result = await moveTask(a.ctx, {
      taskId: created.data.id, statusId: b.statuses[0].id, beforeId: null, afterId: null,
    });
    expect(result.ok).toBe(false);
  });
});

describe('listMyOpenTasks', () => {
  it('returns only tasks assigned to the caller, flagging overdue by workspace zone', async () => {
    const { ctx, projectId } = await setup('ada12@example.com', 'acme12');
    const mine = await createTask(ctx, { projectId, title: 'Mine' });
    const theirs = await createTask(ctx, { projectId, title: 'Unassigned' });
    if (!mine.ok || !theirs.ok) throw new Error('setup failed');

    await updateTask(ctx, {
      taskId: mine.data.id, assigneeId: ctx.userId, dueDate: '2020-01-01',
    });

    const rows = await listMyOpenTasks(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Mine');
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].projectName).toBe('Website');
  });
});

describe('deleteTask', () => {
  it('deletes a task and its subtasks', async () => {
    const { ctx, projectId } = await setup('ada13@example.com', 'acme13');
    const parent = await createTask(ctx, { projectId, title: 'Parent' });
    if (!parent.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId, title: 'Child', parentTaskId: parent.data.id });

    await deleteTask(ctx, { taskId: parent.data.id });

    expect(await db.select().from(task)).toHaveLength(0);
  });

  it('refuses to delete a task in another workspace', async () => {
    const a = await setup('a4@example.com', 'ws-a4');
    const b = await setup('b4@example.com', 'ws-b4');
    const created = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteTask(a.ctx, { taskId: created.data.id })).ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn vitest run tests/server/tasks.test.ts
```

Expected: FAIL — cannot resolve `@/server/tasks/queries`.

- [ ] **Step 3: Implement `src/server/tasks/queries.ts`**

```ts
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, label, project, task, taskLabel, taskStatus, user } from '@/db';
import { isOverdue } from '@/lib/dates';
import type { WorkspaceContext } from '@/lib/session';

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type LabelRow = { id: string; name: string; color: string };

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  position: string;
  completedAt: Date | null;
  labels: LabelRow[];
  subtaskCount: number;
  subtaskDoneCount: number;
};

const baseColumns = {
  id: task.id,
  title: task.title,
  description: task.description,
  statusId: task.statusId,
  priority: task.priority,
  assigneeId: task.assigneeId,
  assigneeName: user.name,
  dueDate: task.dueDate,
  position: task.position,
  completedAt: task.completedAt,
};

async function attachLabels(rows: Omit<TaskRow, 'labels' | 'subtaskCount' | 'subtaskDoneCount'>[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const labelRows = await db
    .select({ taskId: taskLabel.taskId, id: label.id, name: label.name, color: label.color })
    .from(taskLabel)
    .innerJoin(label, eq(label.id, taskLabel.labelId))
    .where(sql`${taskLabel.taskId} in ${ids}`);

  const subtaskRows = await db
    .select({
      parentId: task.parentTaskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${task.completedAt})::int`,
    })
    .from(task)
    .where(sql`${task.parentTaskId} in ${ids}`)
    .groupBy(task.parentTaskId);

  const byTask = new Map(rows.map((r) => [r.id, [] as LabelRow[]]));
  for (const l of labelRows) byTask.get(l.taskId)?.push({ id: l.id, name: l.name, color: l.color });

  const counts = new Map(subtaskRows.map((s) => [s.parentId!, s]));

  return rows.map((r) => ({
    ...r,
    labels: byTask.get(r.id) ?? [],
    subtaskCount: counts.get(r.id)?.total ?? 0,
    subtaskDoneCount: counts.get(r.id)?.done ?? 0,
  }));
}

/** Top-level tasks of one project, board order. Subtasks are loaded with their parent. */
export async function listProjectTasks(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<TaskRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.projectId, projectId),
        eq(task.workspaceId, ctx.workspaceId),
        isNull(task.archivedAt),
        isNull(task.parentTaskId),
      ),
    )
    .orderBy(asc(task.position));

  return attachLabels(rows as never);
}

export async function getTask(ctx: WorkspaceContext, taskId: string): Promise<TaskRow | null> {
  const rows = await db
    .select(baseColumns)
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);

  const [withLabels] = await attachLabels(rows as never);
  return withLabels ?? null;
}

export async function listMyOpenTasks(
  ctx: WorkspaceContext,
): Promise<(TaskRow & { projectId: string; projectName: string; overdue: boolean })[]> {
  const rows = await db
    // projectId comes along so the caller can build a link back to the task's
    // project; it is not on TaskRow because the board already knows its project.
    .select({ ...baseColumns, projectId: task.projectId, projectName: project.name })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        eq(task.assigneeId, ctx.userId),
        isNull(task.completedAt),
        isNull(task.archivedAt),
      ),
    )
    // Nulls last so undated work sinks below dated work.
    .orderBy(sql`${task.dueDate} asc nulls last`, asc(task.position));

  const enriched = await attachLabels(rows as never);

  return enriched.map((row, i) => ({
    ...row,
    projectId: rows[i].projectId,
    projectName: rows[i].projectName,
    // Overdue is computed in the workspace zone, never from the server clock (spec §3.4).
    overdue: row.dueDate ? isOverdue(row.dueDate, ctx.timezone) : false,
  }));
}

/** Statuses of a project, board order. Guarded by workspace so a stray id cannot leak columns. */
export async function listStatuses(ctx: WorkspaceContext, projectId: string) {
  return db
    .select({
      id: taskStatus.id, name: taskStatus.name, color: taskStatus.color,
      position: taskStatus.position, isDone: taskStatus.isDone,
    })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    .where(and(eq(taskStatus.projectId, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .orderBy(asc(taskStatus.position));
}
```

- [ ] **Step 4: Implement `src/server/tasks/actions.ts`**

```ts
'use server';

import { and, asc, desc, eq, isNull, lt, gt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, project, task, taskStatus } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace, type WorkspaceContext } from '@/lib/session';

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

/** Confirms a project belongs to this workspace. Every task write starts here. */
async function assertProject(ctx: WorkspaceContext, projectId: string) {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Confirms a status belongs to a project that belongs to this workspace. */
async function assertStatus(ctx: WorkspaceContext, statusId: string, projectId: string) {
  const [row] = await db
    .select({ id: taskStatus.id, isDone: taskStatus.isDone })
    .from(taskStatus)
    .innerJoin(project, eq(project.id, taskStatus.projectId))
    .where(
      and(
        eq(taskStatus.id, statusId),
        eq(taskStatus.projectId, projectId),
        eq(project.workspaceId, ctx.workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadOwnedTask(ctx: WorkspaceContext, taskId: string) {
  const [row] = await db
    .select({
      id: task.id, projectId: task.projectId, statusId: task.statusId,
      completedAt: task.completedAt,
    })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the task a title.').max(200, 'Title is too long.'),
  statusId: z.string().optional(),
  parentTaskId: z.string().optional(),
});

export async function createTask(
  ctx: WorkspaceContext,
  input: { projectId: string; title: string; statusId?: string; parentTaskId?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    if (!(await assertProject(ctx, parsed.data.projectId))) return err('Project not found.');

    // Default to the leftmost column.
    let statusId = parsed.data.statusId;
    if (statusId) {
      if (!(await assertStatus(ctx, statusId, parsed.data.projectId))) {
        return err('That column does not belong to this project.');
      }
    } else {
      const [first] = await db
        .select({ id: taskStatus.id })
        .from(taskStatus)
        .where(eq(taskStatus.projectId, parsed.data.projectId))
        .orderBy(asc(taskStatus.position))
        .limit(1);
      if (!first) return err('This project has no columns.');
      statusId = first.id;
    }

    const [last] = await db
      .select({ position: task.position })
      .from(task)
      .where(and(eq(task.projectId, parsed.data.projectId), eq(task.statusId, statusId)))
      .orderBy(desc(task.position))
      .limit(1);

    const id = newId();
    await db.insert(task).values({
      id,
      // From the context, never the input: this is what keeps the denormalized
      // column honest (spec §3.3).
      workspaceId: ctx.workspaceId,
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      statusId,
      parentTaskId: parsed.data.parentTaskId,
      position: positionBetween(last?.position ?? null, null),
      createdBy: ctx.userId,
    });

    revalidatePath(`/${ctx.slug}/projects/${parsed.data.projectId}`);
    return ok({ id });
  });
}

const updateSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, 'Give the task a title.').max(200).optional(),
  description: z.string().max(10_000).optional(),
  statusId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  // A calendar date, never an instant (spec §3.4).
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.').nullable().optional(),
});

export async function updateTask(
  ctx: WorkspaceContext,
  input: z.input<typeof updateSchema>,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const owned = await loadOwnedTask(ctx, parsed.data.taskId);
    if (!owned) return err('Task not found.');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.priority !== undefined) patch.priority = parsed.data.priority;
    if (parsed.data.assigneeId !== undefined) patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.dueDate !== undefined) patch.dueDate = parsed.data.dueDate;

    if (parsed.data.statusId !== undefined) {
      const status = await assertStatus(ctx, parsed.data.statusId, owned.projectId);
      if (!status) return err('That column does not belong to this project.');
      patch.statusId = parsed.data.statusId;
      // completed_at follows the column's is_done flag in both directions.
      patch.completedAt = status.isDone ? (owned.completedAt ?? new Date()) : null;
    }

    await db.update(task).set(patch).where(eq(task.id, parsed.data.taskId));

    revalidatePath(`/${ctx.slug}/projects/${owned.projectId}`);
    return ok(null);
  });
}

const moveSchema = z.object({
  taskId: z.string().min(1),
  statusId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

/**
 * The board drop. The client sends neighbours, not a position: the server computes
 * the key, so two concurrent drags cannot agree on the same one.
 */
export async function moveTask(
  ctx: WorkspaceContext,
  input: z.input<typeof moveSchema>,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return err('That move is not valid.');

    const owned = await loadOwnedTask(ctx, parsed.data.taskId);
    if (!owned) return err('Task not found.');

    const status = await assertStatus(ctx, parsed.data.statusId, owned.projectId);
    if (!status) return err('That column does not belong to this project.');

    const neighbourPosition = async (id: string | null) => {
      if (!id) return null;
      const [row] = await db
        .select({ position: task.position })
        .from(task)
        .where(and(eq(task.id, id), eq(task.workspaceId, ctx.workspaceId)))
        .limit(1);
      return row?.position ?? null;
    };

    const [before, after] = await Promise.all([
      neighbourPosition(parsed.data.beforeId),
      neighbourPosition(parsed.data.afterId),
    ]);

    const position = positionBetween(before, after);

    await db
      .update(task)
      .set({
        statusId: parsed.data.statusId,
        position,
        completedAt: status.isDone ? (owned.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(task.id, parsed.data.taskId));

    revalidatePath(`/${ctx.slug}/projects/${owned.projectId}`);
    return ok({ position });
  });
}

export async function deleteTask(
  ctx: WorkspaceContext,
  input: { taskId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const owned = await loadOwnedTask(ctx, input.taskId);
    if (!owned) return err('Task not found.');

    // Subtasks cascade on parent_task_id, so one delete is enough.
    await db.delete(task).where(eq(task.id, input.taskId));

    revalidatePath(`/${ctx.slug}/projects/${owned.projectId}`);
    return ok(null);
  });
}

// --- slug-taking wrappers, so client components can call without a context ---

export async function createTaskAction(
  workspaceSlug: string,
  input: { projectId: string; title: string; statusId?: string; parentTaskId?: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => createTask(await requireWorkspace(workspaceSlug), input));
}

export async function updateTaskAction(
  workspaceSlug: string,
  input: z.input<typeof updateSchema>,
): Promise<Result<null>> {
  return withAction(async () => updateTask(await requireWorkspace(workspaceSlug), input));
}

export async function moveTaskAction(
  workspaceSlug: string,
  input: z.input<typeof moveSchema>,
): Promise<Result<{ position: string }>> {
  return withAction(async () => moveTask(await requireWorkspace(workspaceSlug), input));
}

export async function deleteTaskAction(
  workspaceSlug: string,
  input: { taskId: string },
): Promise<Result<null>> {
  return withAction(async () => deleteTask(await requireWorkspace(workspaceSlug), input));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn vitest run tests/server/tasks.test.ts
```

Expected: PASS, 17 tests. If the `in ${ids}` array syntax errors under this Drizzle version, replace it with `inArray(taskLabel.taskId, ids)` imported from `drizzle-orm`.

- [ ] **Step 6: Run the whole suite**

```bash
yarn test
```

Expected: every test from Tasks 1, 3, 4, 5, 6, 7, 8, 9, and 11 passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: task queries and actions with board move and completion tracking"
```

---

### Task 12: List view

The first screen where a user actually sees and creates tasks. Completes the "first task in under 60 seconds" criterion.

**Files:**
- Create: `src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx`
- Create: `src/components/shell/ViewTabs.tsx`, `src/components/shell/ProjectHeader.tsx`
- Create: `src/components/task/{TaskList,TaskRow,QuickAddTask,PriorityDot,DueChip}.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/page.tsx` (replace the placeholder body)

**Interfaces:**
- Consumes: `listProjectTasks`, `listStatuses`, `listMyOpenTasks`, `createTaskAction`, `updateTaskAction` (Task 11); `getProject` (Task 9); `formatDueDate`, `isOverdue` (Task 3).
- Produces: `<ViewTabs />`, `<TaskList />`, `<QuickAddTask />`, `<PriorityDot />`, `<DueChip />` — all reused by Tasks 13 and 14.

- [ ] **Step 1: Write `src/components/task/PriorityDot.tsx`**

Priority is conveyed by shape and label, not by color alone.

```tsx
import type { Priority } from '@/server/tasks/queries';

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

const PRIORITY_CLASS: Record<Priority, string> = {
  none: 'bg-muted-foreground/30',
  low: 'bg-muted-foreground',
  medium: 'bg-primary',
  high: 'bg-destructive/70',
  urgent: 'bg-destructive',
};

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${PRIORITY_CLASS[priority]}`} aria-hidden="true" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
```

- [ ] **Step 2: Write `src/components/task/DueChip.tsx`**

```tsx
import { CalendarClock } from 'lucide-react';
import { formatDueDate, isOverdue } from '@/lib/dates';

export function DueChip({ dueDate, timezone }: { dueDate: string | null; timezone: string }) {
  if (!dueDate) return null;

  const overdue = isOverdue(dueDate, timezone);

  return (
    <span
      className={`tabular inline-flex items-center gap-1 rounded-[var(--radius-button)] px-1.5 py-0.5 text-xs ${
        overdue ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'
      }`}
    >
      <CalendarClock className="size-3" aria-hidden="true" />
      {/* The word "Overdue" carries the meaning; the red is reinforcement only. */}
      {overdue && <span className="sr-only">Overdue. </span>}
      Due {formatDueDate(dueDate, timezone)}
    </span>
  );
}
```

- [ ] **Step 3: Write `src/components/shell/ViewTabs.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KanbanSquare, List } from 'lucide-react';

export function ViewTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const onBoard = pathname.endsWith('/board');

  const views = [
    { href: basePath, label: 'List', icon: List, active: !onBoard },
    { href: `${basePath}/board`, label: 'Board', icon: KanbanSquare, active: onBoard },
  ];

  return (
    <div role="tablist" aria-label="Project views" className="flex items-center gap-1 rounded-[var(--radius-button)] bg-muted p-1">
      {views.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          role="tab"
          aria-selected={active}
          className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] px-3 text-sm transition-colors duration-150 ${
            active ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/shell/ProjectHeader.tsx`**

```tsx
import { ViewTabs } from '@/components/shell/ViewTabs';

export function ProjectHeader({
  name, basePath, children,
}: { name: string; basePath: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 pl-16 lg:px-6 lg:pl-6">
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{name}</h1>
      <ViewTabs basePath={basePath} />
      {children}
    </header>
  );
}
```

`pl-16` on small screens reserves room for the fixed drawer trigger from Task 10 so the title never sits underneath it.

- [ ] **Step 5: Write `src/components/task/QuickAddTask.tsx`**

```tsx
'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { createTaskAction } from '@/server/tasks/actions';

export function QuickAddTask({
  workspaceSlug, projectId, statusId, placeholder = 'Add a task…',
}: {
  workspaceSlug: string;
  projectId: string;
  statusId?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title) return;

    setPending(true);
    const result = await createTaskAction(workspaceSlug, { projectId, title, statusId });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // Clear and keep focus so several tasks can be typed in a row.
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.focus();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label htmlFor={`quick-add-${statusId ?? 'default'}`} className="sr-only">
        {placeholder}
      </label>
      <input
        id={`quick-add-${statusId ?? 'default'}`}
        ref={inputRef}
        name="title"
        maxLength={200}
        disabled={pending}
        placeholder={placeholder}
        className="h-11 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 lg:text-sm"
      />
    </form>
  );
}
```

- [ ] **Step 6: Write `src/components/task/TaskRow.tsx`**

```tsx
'use client';

import { CircleCheck, Circle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';
import { updateTaskAction } from '@/server/tasks/actions';

export function TaskRow({
  task, statuses, workspaceSlug, timezone,
}: {
  task: TaskRowData;
  statuses: StatusRow[];
  workspaceSlug: string;
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const done = task.completedAt !== null;
  const doneStatus = statuses.find((s) => s.isDone);
  const openStatus = statuses.find((s) => !s.isDone);

  function toggleDone() {
    const target = done ? openStatus : doneStatus;
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, {
        taskId: task.id, statusId: target.id,
      });
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function openDetail() {
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    // Deep-linkable and back-dismissable (spec §6.3).
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <li className="flex items-center gap-3 border-b border-border px-2 transition-colors duration-150 hover:bg-muted/60">
      <button
        type="button"
        onClick={toggleDone}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
      >
        {done
          ? <CircleCheck className="size-5 text-success" aria-hidden="true" />
          : <Circle className="size-5" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={openDetail}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
      >
        <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {task.title}
        </span>

        {task.labels.map((label) => (
          <span key={label.id} className="hidden shrink-0 rounded-[var(--radius-button)] bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">
            {label.name}
          </span>
        ))}

        {task.subtaskCount > 0 && (
          <span className="tabular hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        )}

        <PriorityDot priority={task.priority} />
        <DueChip dueDate={task.dueDate} timezone={timezone} />

        {task.assigneeName && (
          <span
            aria-label={`Assigned to ${task.assigneeName}`}
            className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground sm:inline-flex"
          >
            {task.assigneeName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
    </li>
  );
}
```

- [ ] **Step 7: Write `src/components/task/TaskList.tsx`**

```tsx
import { QuickAddTask } from '@/components/task/QuickAddTask';
import { TaskRow } from '@/components/task/TaskRow';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow as TaskRowData } from '@/server/tasks/queries';

export function TaskList({
  tasks, statuses, workspaceSlug, projectId, timezone,
}: {
  tasks: TaskRowData[];
  statuses: StatusRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
      {tasks.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">No tasks yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Type below to add the first one.
          </p>
        </div>
      ) : (
        <ul className="rounded-[var(--radius-card)] border border-border bg-card">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={statuses}
              workspaceSlug={workspaceSlug}
              timezone={timezone}
            />
          ))}
        </ul>
      )}

      <div className="mt-2 rounded-[var(--radius-card)] border border-border bg-card px-3">
        <QuickAddTask workspaceSlug={workspaceSlug} projectId={projectId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write the list view page**

```tsx
// src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx
import { notFound } from 'next/navigation';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { TaskList } from '@/components/task/TaskList';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectListPage({
  params,
}: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  return (
    <main>
      <ProjectHeader name={project.name} basePath={basePath} />
      <TaskList
        tasks={tasks}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        timezone={ctx.timezone}
      />
    </main>
  );
}
```

- [ ] **Step 9: Replace the workspace home body with assigned tasks**

```tsx
// src/app/(app)/[workspaceSlug]/page.tsx
import Link from 'next/link';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import { requireWorkspace } from '@/lib/session';
import { listMyOpenTasks } from '@/server/tasks/queries';

export default async function WorkspaceHome({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const tasks = await listMyOpenTasks(ctx);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <h1 className="text-2xl font-semibold text-foreground">My tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Open work assigned to you across every project.
      </p>

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nothing assigned to you</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a project from the sidebar to pick up work.
          </p>
        </div>
      ) : (
        <ul className="mt-6 rounded-[var(--radius-card)] border border-border bg-card">
          {tasks.map((task) => (
            <li key={task.id} className="border-b border-border last:border-b-0">
              <Link
                href={`/${workspaceSlug}/projects/${task.projectId}?task=${task.id}`}
                className="flex items-center gap-3 px-3 py-3 transition-colors duration-150 hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {task.projectName}
                </span>
                <PriorityDot priority={task.priority} />
                <DueChip dueDate={task.dueDate} timezone={ctx.timezone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 10: Mount the toaster**

Add to `src/app/layout.tsx` inside `<ThemeProvider>`, after `{children}`:

```tsx
import { Toaster } from '@/components/ui/sonner';
// …
<Toaster position="bottom-right" />
```

Sonner's toasts use `aria-live` and do not steal focus, which is what the design requires.

- [ ] **Step 11: Verify by hand**

```bash
yarn dev
```

Confirm: typing a title and pressing Enter adds a task and keeps focus in the field so a second can be typed immediately; the circle button marks a task done and the title goes struck-through; tabbing reaches every control with a visible ring; at 375px there is no horizontal scroll.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: project list view with quick add and my-tasks home"
```

---

### Task 13: Board view with pointer and keyboard drag

**Files:**
- Create: `src/app/(app)/[workspaceSlug]/projects/[projectId]/board/page.tsx`
- Create: `src/components/board/{Board,BoardColumn,TaskCard}.tsx`

**Interfaces:**
- Consumes: `listProjectTasks`, `moveTaskAction` (Task 11); `getProject` (Task 9); `QuickAddTask`, `PriorityDot`, `DueChip` (Task 12).
- Produces: `<Board />`.

- [ ] **Step 1: Write the board page**

```tsx
// src/app/(app)/[workspaceSlug]/projects/[projectId]/board/page.tsx
import { notFound } from 'next/navigation';
import { Board } from '@/components/board/Board';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { listProjectTasks } from '@/server/tasks/queries';

export default async function ProjectBoardPage({
  params,
}: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const tasks = await listProjectTasks(ctx, projectId);
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  return (
    <main className="flex h-dvh flex-col">
      <ProjectHeader name={project.name} basePath={basePath} />
      <Board
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        statuses={project.statuses}
        tasks={tasks}
        timezone={ctx.timezone}
      />
    </main>
  );
}
```

- [ ] **Step 2: Write `src/components/board/TaskCard.tsx`**

```tsx
'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DueChip } from '@/components/task/DueChip';
import { PriorityDot } from '@/components/task/PriorityDot';
import type { TaskRow } from '@/server/tasks/queries';

export function TaskCard({
  task, timezone, onOpen,
}: { task: TaskRow; timezone: string; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-[var(--radius-card)] border border-border bg-card p-3 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onOpen(task.id)}
        // dnd-kit puts the keyboard sensor on this button: Space lifts, arrows
        // move, Space drops, Escape cancels. A pointer-only board is unusable
        // with a keyboard, so this is required, not an enhancement (spec §6.4).
        className="w-full cursor-grab text-left active:cursor-grabbing"
      >
        <p className="text-sm text-foreground">{task.title}</p>

        {task.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.labels.map((label) => (
              <span key={label.id} className="rounded-[var(--radius-button)] bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {label.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PriorityDot priority={task.priority} />
          <DueChip dueDate={task.dueDate} timezone={timezone} />
          {task.subtaskCount > 0 && (
            <span className="tabular text-xs text-muted-foreground">
              {task.subtaskDoneCount}/{task.subtaskCount}
            </span>
          )}
          {task.assigneeName && (
            <span
              aria-label={`Assigned to ${task.assigneeName}`}
              className="ml-auto inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            >
              {task.assigneeName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
```

- [ ] **Step 3: Write `src/components/board/BoardColumn.tsx`**

```tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from '@/components/board/TaskCard';
import { QuickAddTask } from '@/components/task/QuickAddTask';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow } from '@/server/tasks/queries';

export function BoardColumn({
  status, tasks, workspaceSlug, projectId, timezone, onOpen,
}: {
  status: StatusRow;
  tasks: TaskRow[];
  workspaceSlug: string;
  projectId: string;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status.id}` });

  return (
    <section
      aria-label={status.name}
      className="flex w-[280px] shrink-0 flex-col rounded-[var(--radius-panel)] bg-muted/50"
    >
      <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground">
        {status.name}
        <span className="tabular text-xs font-normal text-muted-foreground">{tasks.length}</span>
      </h2>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 ${
            isOver ? 'rounded-[var(--radius-panel)] ring-2 ring-ring' : ''
          }`}
        >
          {tasks.length === 0 && (
            <li className="rounded-[var(--radius-card)] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Drop a task here
            </li>
          )}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} timezone={timezone} onOpen={onOpen} />
          ))}
        </ul>
      </SortableContext>

      <div className="border-t border-border px-3">
        <QuickAddTask
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          statusId={status.id}
          placeholder={`Add to ${status.name}…`}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Write `src/components/board/Board.tsx`**

```tsx
'use client';

import {
  DndContext, KeyboardSensor, PointerSensor, closestCorners,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BoardColumn } from '@/components/board/BoardColumn';
import type { StatusRow } from '@/server/projects/queries';
import { moveTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';

type Move = { taskId: string; statusId: string; index: number };

export function Board({
  workspaceSlug, projectId, statuses, tasks, timezone,
}: {
  workspaceSlug: string;
  projectId: string;
  statuses: StatusRow[];
  tasks: TaskRow[];
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState('');

  // The card moves the instant it is dropped; the server call follows.
  const [optimisticTasks, applyMove] = useOptimistic(tasks, (current: TaskRow[], move: Move) => {
    const moving = current.find((t) => t.id === move.taskId);
    if (!moving) return current;

    const rest = current.filter((t) => t.id !== move.taskId);
    const target = rest.filter((t) => t.statusId === move.statusId);
    const others = rest.filter((t) => t.statusId !== move.statusId);
    const updated = { ...moving, statusId: move.statusId };

    target.splice(move.index, 0, updated);
    return [...others, ...target];
  });

  const sensors = useSensors(
    // An 8px threshold so a click to open the detail panel is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStatus = (statusId: string) => optimisticTasks.filter((t) => t.statusId === statusId);

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('task', taskId);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);

    // Dropping on a column drops at its end; dropping on a card inserts at that card.
    const targetStatusId = overId.startsWith('status:')
      ? overId.slice('status:'.length)
      : optimisticTasks.find((t) => t.id === overId)?.statusId;

    if (!targetStatusId) return;

    const column = byStatus(targetStatusId).filter((t) => t.id !== taskId);
    const index = overId.startsWith('status:')
      ? column.length
      : Math.max(0, column.findIndex((t) => t.id === overId));

    const beforeId = column[index - 1]?.id ?? null;
    const afterId = column[index]?.id ?? null;

    const statusName = statuses.find((s) => s.id === targetStatusId)?.name ?? 'column';
    setAnnouncement(`Moved to ${statusName}, position ${index + 1} of ${column.length + 1}.`);

    startTransition(async () => {
      applyMove({ taskId, statusId: targetStatusId, index });

      // Neighbour ids, never a position: the server computes the key so two
      // concurrent drags cannot land on the same one (spec §6.4).
      const result = await moveTaskAction(workspaceSlug, {
        taskId, statusId: targetStatusId, beforeId, afterId,
      });

      if (!result.ok) {
        toast.error(result.error, {
          action: {
            label: 'Retry',
            onClick: () => {
              startTransition(async () => {
                const retry = await moveTaskAction(workspaceSlug, {
                  taskId, statusId: targetStatusId, beforeId, afterId,
                });
                if (!retry.ok) toast.error(retry.error);
                router.refresh();
              });
            },
          },
        });
      }
      // Refresh either way: on success to confirm, on failure to discard the
      // optimistic move and show the truth.
      router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      {/* Horizontal scroll lives here, never on the page (spec §6.4). */}
      <div className="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 lg:px-6">
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            tasks={byStatus(status.id)}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            timezone={timezone}
            onOpen={openTask}
          />
        ))}
      </div>

      <p aria-live="polite" className="sr-only">{announcement}</p>
    </DndContext>
  );
}
```

- [ ] **Step 5: Add the missing dnd-kit utilities package**

```bash
yarn add --exact @dnd-kit/utilities@3.2.2
```

- [ ] **Step 6: Verify pointer dragging by hand**

```bash
yarn dev
```

Create three tasks, open the Board tab, and confirm: dragging a card between columns moves it instantly; reloading keeps the new column; dragging into a gap between two cards holds that exact position after reload; the page never scrolls sideways at 375px but the board container does.

- [ ] **Step 7: Verify keyboard dragging by hand**

With the mouse untouched: Tab to a card, press Space to lift, arrow right to the next column, Space to drop. Confirm the move persists after reload and that a screen reader announcement is produced. If arrow keys scroll the page instead of moving the card, the `KeyboardSensor` is not wired — fix it before committing, since the board is otherwise inaccessible.

- [ ] **Step 8: Verify reduced motion**

In devtools, emulate `prefers-reduced-motion: reduce` and confirm cards still move and drop correctly with transitions suppressed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: kanban board with pointer and keyboard drag and optimistic moves"
```

---

### Task 14: Task detail panel and inline labels

The slide-over that both views open via `?task=<id>`. Includes label creation, which has no other UI in v1 (spec §3.2).

**Files:**
- Create: `src/server/labels/{queries.ts,actions.ts}`, `tests/server/labels.test.ts`
- Create: `src/components/task/{TaskDetailPanel,LabelPicker,DueDateField,AssigneePicker}.tsx`
- Modify: both project view pages to render the panel

**Interfaces:**
- Consumes: `getTask`, `updateTaskAction`, `deleteTaskAction` (Task 11); `listWorkspaceMembers` (added here, reused by Task 15).
- Produces:
  - `listLabels(ctx): Promise<LabelRow[]>`
  - `listWorkspaceMembers(ctx): Promise<MemberRow[]>` where `MemberRow = { userId, name, email, role }`
  - `createLabelAction(workspaceSlug, { name }): Promise<Result<LabelRow>>`
  - `setTaskLabelsAction(workspaceSlug, { taskId, labelIds }): Promise<Result<null>>`
  - `deleteLabelAction(workspaceSlug, { labelId }): Promise<Result<null>>`

- [ ] **Step 1: Write the failing label tests**

```ts
// tests/server/labels.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/actions';
import { getProject } from '@/server/projects/queries';
import { createTask } from '@/server/tasks/actions';
import { getTask } from '@/server/tasks/queries';
import { createLabel, setTaskLabels } from '@/server/labels/actions';
import { listLabels } from '@/server/labels/queries';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, project.data.id);
  return { ctx, projectId: project.data.id, statuses: detail!.statuses };
}

describe('createLabel', () => {
  it('creates a workspace-scoped label', async () => {
    const { ctx } = await setup('ada@example.com', 'acme');

    const result = await createLabel(ctx, { name: 'bug' });

    expect(result.ok).toBe(true);
    const labels = await listLabels(ctx);
    expect(labels.map((l) => l.name)).toEqual(['bug']);
  });

  it('returns the existing label instead of failing on a duplicate name', async () => {
    const { ctx } = await setup('ada2@example.com', 'acme2');
    const first = await createLabel(ctx, { name: 'bug' });
    const second = await createLabel(ctx, { name: 'bug' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Typing an existing name in the picker must attach it, not error.
    expect(second.data.id).toBe(first.data.id);
    expect(await listLabels(ctx)).toHaveLength(1);
  });

  it('allows the same label name in two workspaces', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    expect((await createLabel(a.ctx, { name: 'bug' })).ok).toBe(true);
    expect((await createLabel(b.ctx, { name: 'bug' })).ok).toBe(true);
  });

  it('rejects an empty name', async () => {
    const { ctx } = await setup('ada3@example.com', 'acme3');
    expect((await createLabel(ctx, { name: '  ' })).ok).toBe(false);
  });
});

describe('setTaskLabels', () => {
  it('replaces the label set on a task', async () => {
    const { ctx, projectId } = await setup('ada4@example.com', 'acme4');
    const created = await createTask(ctx, { projectId, title: 'Task' });
    const bug = await createLabel(ctx, { name: 'bug' });
    const docs = await createLabel(ctx, { name: 'docs' });
    if (!created.ok || !bug.ok || !docs.ok) throw new Error('setup failed');

    await setTaskLabels(ctx, { taskId: created.data.id, labelIds: [bug.data.id, docs.data.id] });
    await setTaskLabels(ctx, { taskId: created.data.id, labelIds: [docs.data.id] });

    const after = await getTask(ctx, created.data.id);
    expect(after!.labels.map((l) => l.name)).toEqual(['docs']);
  });

  it('refuses a label from another workspace', async () => {
    const a = await setup('a2@example.com', 'ws-a2');
    const b = await setup('b2@example.com', 'ws-b2');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Task' });
    const foreign = await createLabel(b.ctx, { name: 'theirs' });
    if (!created.ok || !foreign.ok) throw new Error('setup failed');

    const result = await setTaskLabels(a.ctx, {
      taskId: created.data.id, labelIds: [foreign.data.id],
    });

    expect(result.ok).toBe(false);
    expect((await getTask(a.ctx, created.data.id))!.labels).toHaveLength(0);
  });

  it('refuses to label a task in another workspace', async () => {
    const a = await setup('a3@example.com', 'ws-a3');
    const b = await setup('b3@example.com', 'ws-b3');
    const theirs = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    const mine = await createLabel(a.ctx, { name: 'mine' });
    if (!theirs.ok || !mine.ok) throw new Error('setup failed');

    const result = await setTaskLabels(a.ctx, {
      taskId: theirs.data.id, labelIds: [mine.data.id],
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
yarn vitest run tests/server/labels.test.ts
```

Expected: FAIL — cannot resolve `@/server/labels/actions`.

- [ ] **Step 3: Implement `src/server/labels/queries.ts`**

```ts
import { asc, eq } from 'drizzle-orm';
import { db, label, member, user } from '@/db';
import type { WorkspaceContext, WorkspaceRole } from '@/lib/session';
import type { LabelRow } from '@/server/tasks/queries';

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

export async function listLabels(ctx: WorkspaceContext): Promise<LabelRow[]> {
  return db
    .select({ id: label.id, name: label.name, color: label.color })
    .from(label)
    .where(eq(label.workspaceId, ctx.workspaceId))
    .orderBy(asc(label.name));
}

/** Lives here rather than in members/ because the assignee picker needs it first. */
export async function listWorkspaceMembers(ctx: WorkspaceContext): Promise<MemberRow[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.workspaceId))
    .orderBy(asc(user.name));

  return rows.map((r) => ({ ...r, role: r.role as WorkspaceRole }));
}
```

- [ ] **Step 4: Implement `src/server/labels/actions.ts`**

```ts
'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, label, task, taskLabel } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace, type WorkspaceContext } from '@/lib/session';
import type { LabelRow } from '@/server/tasks/queries';

const nameSchema = z.string().trim().min(1, 'Name the label.').max(32, 'Keep it under 32 characters.');

export async function createLabel(
  ctx: WorkspaceContext,
  input: { name: string; color?: string },
): Promise<Result<LabelRow>> {
  return withAction(async () => {
    const parsed = z.object({ name: nameSchema, color: z.string().optional() }).safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    // Typing an existing name in the picker must attach that label, not error out,
    // so a duplicate returns the existing row.
    const [existing] = await db
      .select({ id: label.id, name: label.name, color: label.color })
      .from(label)
      .where(and(eq(label.workspaceId, ctx.workspaceId), eq(label.name, parsed.data.name)))
      .limit(1);

    if (existing) return ok(existing);

    const row = {
      id: newId(),
      workspaceId: ctx.workspaceId,
      name: parsed.data.name,
      color: parsed.data.color ?? 'muted',
    };
    await db.insert(label).values(row);

    return ok({ id: row.id, name: row.name, color: row.color });
  });
}

export async function setTaskLabels(
  ctx: WorkspaceContext,
  input: { taskId: string; labelIds: string[] },
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z
      .object({ taskId: z.string().min(1), labelIds: z.array(z.string()).max(20) })
      .safeParse(input);
    if (!parsed.success) return err('That label selection is not valid.');

    const [owned] = await db
      .select({ id: task.id, projectId: task.projectId })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    if (parsed.data.labelIds.length > 0) {
      // Every id must belong to this workspace, or the whole call is rejected.
      const valid = await db
        .select({ id: label.id })
        .from(label)
        .where(
          and(eq(label.workspaceId, ctx.workspaceId), inArray(label.id, parsed.data.labelIds)),
        );
      if (valid.length !== parsed.data.labelIds.length) return err('Unknown label.');
    }

    await db.transaction(async (tx) => {
      await tx.delete(taskLabel).where(eq(taskLabel.taskId, parsed.data.taskId));
      if (parsed.data.labelIds.length > 0) {
        await tx.insert(taskLabel).values(
          parsed.data.labelIds.map((labelId) => ({ taskId: parsed.data.taskId, labelId })),
        );
      }
    });

    revalidatePath(`/${ctx.slug}/projects/${owned.projectId}`);
    return ok(null);
  });
}

export async function deleteLabel(
  ctx: WorkspaceContext,
  input: { labelId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const deleted = await db
      .delete(label)
      .where(and(eq(label.id, input.labelId), eq(label.workspaceId, ctx.workspaceId)))
      .returning({ id: label.id });

    if (deleted.length === 0) return err('Label not found.');

    revalidatePath(`/${ctx.slug}`);
    return ok(null);
  });
}

// --- slug-taking wrappers ---

export async function createLabelAction(
  workspaceSlug: string, input: { name: string },
): Promise<Result<LabelRow>> {
  return withAction(async () => createLabel(await requireWorkspace(workspaceSlug), input));
}

export async function setTaskLabelsAction(
  workspaceSlug: string, input: { taskId: string; labelIds: string[] },
): Promise<Result<null>> {
  return withAction(async () => setTaskLabels(await requireWorkspace(workspaceSlug), input));
}

export async function deleteLabelAction(
  workspaceSlug: string, input: { labelId: string },
): Promise<Result<null>> {
  return withAction(async () => deleteLabel(await requireWorkspace(workspaceSlug), input));
}
```

- [ ] **Step 5: Run to verify the tests pass**

```bash
yarn vitest run tests/server/labels.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Write `src/components/task/LabelPicker.tsx`**

```tsx
'use client';

import { Check, Tag, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { createLabelAction, deleteLabelAction, setTaskLabelsAction } from '@/server/labels/actions';
import type { LabelRow } from '@/server/tasks/queries';

export function LabelPicker({
  workspaceSlug, taskId, allLabels, selected,
}: {
  workspaceSlug: string;
  taskId: string;
  allLabels: LabelRow[];
  selected: LabelRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const selectedIds = new Set(selected.map((l) => l.id));

  function apply(labelIds: string[]) {
    startTransition(async () => {
      const result = await setTaskLabelsAction(workspaceSlug, { taskId, labelIds });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function toggle(labelId: string) {
    const next = selectedIds.has(labelId)
      ? [...selectedIds].filter((id) => id !== labelId)
      : [...selectedIds, labelId];
    apply(next);
  }

  function onCreate(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const name = draft.trim();
    if (!name) return;

    startTransition(async () => {
      // Creating an existing name returns that label, so typing a duplicate
      // simply attaches it.
      const created = await createLabelAction(workspaceSlug, { name });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      setDraft('');
      apply([...selectedIds, created.data.id]);
    });
  }

  function onDelete(labelId: string) {
    startTransition(async () => {
      const result = await deleteLabelAction(workspaceSlug, { labelId });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
        <Tag className="size-4" aria-hidden="true" />
        {selected.length > 0 ? selected.map((l) => l.name).join(', ') : 'Add labels'}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <div className="p-2">
          <label htmlFor="new-label" className="sr-only">New label name</label>
          <Input
            id="new-label"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onCreate}
            maxLength={32}
            placeholder="Type a name, press Enter"
            className="h-9 text-base lg:text-sm"
          />
        </div>

        {allLabels.length > 0 && <DropdownMenuSeparator />}

        {allLabels.map((label) => (
          <DropdownMenuItem
            key={label.id}
            onSelect={(event) => { event.preventDefault(); toggle(label.id); }}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <Check className={`size-4 ${selectedIds.has(label.id) ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              {label.name}
            </span>
            <button
              type="button"
              aria-label={`Delete label ${label.name}`}
              onClick={(event) => { event.stopPropagation(); onDelete(label.id); }}
              className="text-muted-foreground transition-colors duration-150 hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 7: Write `src/components/task/TaskDetailPanel.tsx`**

```tsx
'use client';

import { Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LabelPicker } from '@/components/task/LabelPicker';
import type { StatusRow } from '@/server/projects/queries';
import type { MemberRow } from '@/server/labels/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { LabelRow, Priority, TaskRow } from '@/server/tasks/queries';

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];

export function TaskDetailPanel({
  task, statuses, members, allLabels, workspaceSlug,
}: {
  task: TaskRow;
  statuses: StatusRow[];
  members: MemberRow[];
  allLabels: LabelRow[];
  workspaceSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);

  function close() {
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    const query = next.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  }

  function patch(input: Parameters<typeof updateTaskAction>[1]) {
    startTransition(async () => {
      const result = await updateTaskAction(workspaceSlug, input);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm(`Delete "${task.title}"? This also deletes its subtasks.`)) return;
    startTransition(async () => {
      const result = await deleteTaskAction(workspaceSlug, { taskId: task.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetTitle className="sr-only">Task details</SheetTitle>

        <div className="space-y-5 p-5">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              // Save on blur, not per keystroke, so one edit is one write.
              onBlur={() => title.trim() && title !== task.title && patch({ taskId: task.id, title })}
              maxLength={200}
              className="h-11 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== task.description && patch({ taskId: task.id, description })}
              rows={6}
              maxLength={10000}
              className="w-full rounded-[var(--radius-card)] border border-border bg-card p-3 text-base text-foreground lg:text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-status">Status</Label>
              <Select
                defaultValue={task.statusId}
                onValueChange={(statusId) => patch({ taskId: task.id, statusId })}
              >
                <SelectTrigger id="task-status" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                defaultValue={task.priority}
                onValueChange={(priority) => patch({ taskId: task.id, priority: priority as Priority })}
              >
                <SelectTrigger id="task-priority" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-assignee">Assignee</Label>
              <Select
                defaultValue={task.assigneeId ?? 'unassigned'}
                onValueChange={(value) =>
                  patch({ taskId: task.id, assigneeId: value === 'unassigned' ? null : value })
                }
              >
                <SelectTrigger id="task-assignee" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                defaultValue={task.dueDate ?? ''}
                // A bare YYYY-MM-DD string, never a Date: the value is a calendar
                // day in the workspace zone (spec §3.4).
                onChange={(e) => patch({ taskId: task.id, dueDate: e.target.value || null })}
                className="h-11 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Labels</Label>
            <LabelPicker
              workspaceSlug={workspaceSlug}
              taskId={task.id}
              allLabels={allLabels}
              selected={task.labels}
            />
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-button)] px-3 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete task
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 8: Render the panel from both views**

Both page components take `searchParams`. Add to each of `projects/[projectId]/page.tsx` and `projects/[projectId]/board/page.tsx`:

```tsx
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  // …existing body…
  const { task: openTaskId } = await searchParams;
  const openTask = openTaskId ? await getTask(ctx, openTaskId) : null;
  const [members, allLabels] = openTask
    ? await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx)])
    : [[], []];

  return (
    <main>
      {/* …existing content… */}
      {openTask && (
        <TaskDetailPanel
          task={openTask}
          statuses={project.statuses}
          members={members}
          allLabels={allLabels}
          workspaceSlug={workspaceSlug}
        />
      )}
    </main>
  );
}
```

Add the imports for `getTask`, `listWorkspaceMembers`, `listLabels`, and `TaskDetailPanel` to both files.

- [ ] **Step 9: Verify by hand**

```bash
yarn dev
```

Confirm: clicking a task opens the panel and the URL gains `?task=<id>`; the browser back button closes it; reloading with that URL reopens it; editing the title and clicking away saves; typing a new label name and pressing Enter creates and attaches it; typing an existing name attaches it rather than erroring; deleting asks for confirmation first.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: task detail panel with inline label creation"
```

---

### Task 15: Members, invitations, and workspace settings

Closes the second success criterion: an owner invites a teammate who accepts and sees the same projects.

**Files:**
- Create: `src/server/members/{queries.ts,actions.ts}`, `src/server/settings/actions.ts`, `src/lib/email.ts`
- Create: `src/app/(app)/[workspaceSlug]/settings/members/page.tsx`, `src/app/(app)/[workspaceSlug]/settings/general/page.tsx`, `src/app/(auth)/invite/[invitationId]/page.tsx`
- Create: `src/components/settings/{InviteForm,MemberTable,TimezoneForm}.tsx`
- Create: `tests/server/members.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `WorkspaceContext` (Task 7); `listWorkspaceMembers` (Task 14); `auth` (Task 6).
- Produces:
  - `inviteMember(ctx, { email, role }): Promise<Result<{ invitationId: string }>>`
  - `removeMember(ctx, { userId }): Promise<Result<null>>`
  - `changeMemberRole(ctx, { userId, role }): Promise<Result<null>>`
  - `updateWorkspaceSettings(ctx, { timezone, weekStart }): Promise<Result<null>>`
  - `sendInviteEmail(to, url, workspaceName): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/members.test.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { changeMemberRole, inviteMember, removeMember } from '@/server/members/actions';
import { updateWorkspaceSettings } from '@/server/settings/actions';
import { listWorkspaceMembers } from '@/server/labels/queries';
import { invitation, member, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string, role: 'owner' | 'admin' | 'member' = 'owner') {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role, timezone: 'Asia/Yerevan',
  };
  return { ctx, ws, user };
}

describe('inviteMember', () => {
  it('creates a pending invitation for an owner', async () => {
    const { ctx } = await setup('owner@example.com', 'acme');

    const result = await inviteMember(ctx, { email: 'new@example.com', role: 'member' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(invitation);
    expect(row.email).toBe('new@example.com');
    expect(row.status).toBe('pending');
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a plain member', async () => {
    const { ctx } = await setup('member@example.com', 'acme2', 'member');
    const result = await inviteMember(ctx, { email: 'new@example.com', role: 'member' });

    expect(result.ok).toBe(false);
    expect(await db.select().from(invitation)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const { ctx } = await setup('owner2@example.com', 'acme3');
    expect((await inviteMember(ctx, { email: 'not-an-email', role: 'member' })).ok).toBe(false);
  });

  it('refuses to invite someone who is already a member', async () => {
    const { ctx, ws } = await setup('owner3@example.com', 'acme4');
    const bob = await createUser('bob@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    expect((await inviteMember(ctx, { email: 'bob@example.com', role: 'member' })).ok).toBe(false);
  });
});

describe('removeMember', () => {
  it('removes a member as an owner', async () => {
    const { ctx, ws } = await setup('owner4@example.com', 'acme5');
    const bob = await createUser('bob2@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const result = await removeMember(ctx, { userId: bob.id });

    expect(result.ok).toBe(true);
    expect(await listWorkspaceMembers(ctx)).toHaveLength(1);
  });

  it('refuses to remove the last owner', async () => {
    const { ctx } = await setup('owner5@example.com', 'acme6');

    // Removing the only owner would orphan the workspace: nobody could ever
    // change roles or delete it again.
    const result = await removeMember(ctx, { userId: ctx.userId });

    expect(result.ok).toBe(false);
    expect(await listWorkspaceMembers(ctx)).toHaveLength(1);
  });

  it('refuses a plain member', async () => {
    const { ctx, ws } = await setup('owner6@example.com', 'acme7');
    const bob = await createUser('bob3@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const asMember = { ...ctx, role: 'member' as const };
    expect((await removeMember(asMember, { userId: bob.id })).ok).toBe(false);
  });
});

describe('changeMemberRole', () => {
  it('promotes a member as an owner', async () => {
    const { ctx, ws } = await setup('owner7@example.com', 'acme8');
    const bob = await createUser('bob4@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const result = await changeMemberRole(ctx, { userId: bob.id, role: 'admin' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(member).where(eq(member.userId, bob.id));
    expect(row.role).toBe('admin');
  });

  it('refuses an admin, since only an owner may change roles', async () => {
    const { ctx, ws } = await setup('owner8@example.com', 'acme9');
    const bob = await createUser('bob5@example.com');
    await joinWorkspace(bob.id, ws.id, 'member');

    const asAdmin = { ...ctx, role: 'admin' as const };
    expect((await changeMemberRole(asAdmin, { userId: bob.id, role: 'admin' })).ok).toBe(false);
  });

  it('refuses to demote the last owner', async () => {
    const { ctx } = await setup('owner9@example.com', 'acme10');
    expect((await changeMemberRole(ctx, { userId: ctx.userId, role: 'member' })).ok).toBe(false);
  });
});

describe('updateWorkspaceSettings', () => {
  it('changes the timezone as an admin', async () => {
    const { ctx } = await setup('owner10@example.com', 'acme11');
    const asAdmin = { ...ctx, role: 'admin' as const };

    const result = await updateWorkspaceSettings(asAdmin, { timezone: 'Europe/Berlin' });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, ctx.workspaceId));
    expect(row.timezone).toBe('Europe/Berlin');
  });

  it('rejects a timezone that is not a real IANA zone', async () => {
    const { ctx } = await setup('owner11@example.com', 'acme12');
    expect((await updateWorkspaceSettings(ctx, { timezone: 'Mars/Olympus' })).ok).toBe(false);
  });

  it('refuses a plain member', async () => {
    const { ctx } = await setup('owner12@example.com', 'acme13');
    const asMember = { ...ctx, role: 'member' as const };
    expect((await updateWorkspaceSettings(asMember, { timezone: 'UTC' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
yarn vitest run tests/server/members.test.ts
```

Expected: FAIL — cannot resolve `@/server/members/actions`.

- [ ] **Step 3: Implement `src/lib/email.ts`**

```ts
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

/**
 * Without an API key, invitations log their link to the server console instead
 * of failing. Development and CI then work with no external account, and the
 * invite flow is still fully exercisable.
 */
export async function sendInviteEmail(
  to: string, url: string, workspaceName: string,
): Promise<void> {
  if (!apiKey) {
    console.info(`[invite] ${to} -> ${url} (${workspaceName})`);
    return;
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: 'Taskeeper <invites@taskeeper.app>',
    to,
    subject: `Join ${workspaceName} on Taskeeper`,
    text: `You have been invited to join ${workspaceName}.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
  });
}
```

- [ ] **Step 4: Implement `src/server/members/actions.ts`**

```ts
'use server';

import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, invitation, member, organization, user } from '@/db';
import { sendInviteEmail } from '@/lib/email';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, requireWorkspace, type WorkspaceContext } from '@/lib/session';

const INVITE_TTL_DAYS = 7;

async function ownerCount(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.role, 'owner')));
  return row?.n ?? 0;
}

export async function inviteMember(
  ctx: WorkspaceContext,
  input: { email: string; role: 'admin' | 'member' },
): Promise<Result<{ invitationId: string }>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = z
      .object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
                role: z.enum(['admin', 'member']) })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const [existing] = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(user.email, parsed.data.email)))
      .limit(1);
    if (existing) return err('That person is already in this workspace.');

    const id = newId();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db.insert(invitation).values({
      id, organizationId: ctx.workspaceId, email: parsed.data.email,
      role: parsed.data.role, status: 'pending', expiresAt, inviterId: ctx.userId,
    });

    const [ws] = await db
      .select({ name: organization.name })
      .from(organization).where(eq(organization.id, ctx.workspaceId)).limit(1);

    await sendInviteEmail(
      parsed.data.email,
      `${process.env.BETTER_AUTH_URL}/invite/${id}`,
      ws?.name ?? 'the workspace',
    );

    revalidatePath(`/${ctx.slug}/settings/members`);
    return ok({ invitationId: id });
  });
}

export async function removeMember(
  ctx: WorkspaceContext, input: { userId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const [target] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)))
      .limit(1);
    if (!target) return err('That person is not in this workspace.');

    // Removing the last owner would leave nobody able to manage the workspace.
    if (target.role === 'owner' && (await ownerCount(ctx.workspaceId)) <= 1) {
      return err('A workspace must keep at least one owner.');
    }
    if (target.role === 'owner') requireRole(ctx, 'owner');

    await db
      .delete(member)
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)));

    revalidatePath(`/${ctx.slug}/settings/members`);
    return ok(null);
  });
}

export async function changeMemberRole(
  ctx: WorkspaceContext, input: { userId: string; role: 'owner' | 'admin' | 'member' },
): Promise<Result<null>> {
  return withAction(async () => {
    // Only an owner changes roles (spec §4).
    requireRole(ctx, 'owner');

    const parsed = z
      .object({ userId: z.string().min(1), role: z.enum(['owner', 'admin', 'member']) })
      .safeParse(input);
    if (!parsed.success) return err('That role is not valid.');

    const [target] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)))
      .limit(1);
    if (!target) return err('That person is not in this workspace.');

    if (target.role === 'owner' && parsed.data.role !== 'owner'
        && (await ownerCount(ctx.workspaceId)) <= 1) {
      return err('A workspace must keep at least one owner.');
    }

    await db
      .update(member)
      .set({ role: parsed.data.role })
      .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, parsed.data.userId)));

    revalidatePath(`/${ctx.slug}/settings/members`);
    return ok(null);
  });
}

export async function acceptInvitation(
  userId: string, userEmail: string, invitationId: string,
): Promise<Result<{ slug: string }>> {
  return withAction(async () => {
    const [invite] = await db
      .select({
        id: invitation.id, organizationId: invitation.organizationId, email: invitation.email,
        role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1);

    if (!invite || invite.status !== 'pending') return err('This invitation is no longer valid.');
    if (invite.expiresAt.getTime() < Date.now()) return err('This invitation has expired.');
    // Bound to the invited address, so a forwarded link cannot be redeemed by
    // whoever happens to open it.
    if (invite.email !== userEmail.toLowerCase()) {
      return err('This invitation was sent to a different email address.');
    }

    const [org] = await db
      .select({ slug: organization.slug })
      .from(organization).where(eq(organization.id, invite.organizationId)).limit(1);
    if (!org) return err('That workspace no longer exists.');

    await db.transaction(async (tx) => {
      const [already] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, invite.organizationId), eq(member.userId, userId)))
        .limit(1);

      if (!already) {
        await tx.insert(member).values({
          id: newId(), organizationId: invite.organizationId, userId,
          role: invite.role ?? 'member',
        });
      }
      await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invite.id));
    });

    return ok({ slug: org.slug });
  });
}

// --- slug-taking wrappers ---

export async function inviteMemberAction(
  workspaceSlug: string, input: { email: string; role: 'admin' | 'member' },
): Promise<Result<{ invitationId: string }>> {
  return withAction(async () => inviteMember(await requireWorkspace(workspaceSlug), input));
}

export async function removeMemberAction(
  workspaceSlug: string, input: { userId: string },
): Promise<Result<null>> {
  return withAction(async () => removeMember(await requireWorkspace(workspaceSlug), input));
}

export async function changeMemberRoleAction(
  workspaceSlug: string, input: { userId: string; role: 'owner' | 'admin' | 'member' },
): Promise<Result<null>> {
  return withAction(async () => changeMemberRole(await requireWorkspace(workspaceSlug), input));
}
```

- [ ] **Step 5: Implement `src/server/settings/actions.ts`**

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, workspaceSettings } from '@/db';
import { err, ok, withAction, type Result } from '@/lib/result';
import { requireRole, requireWorkspace, type WorkspaceContext } from '@/lib/session';

/** Asks the runtime whether a zone exists rather than shipping a list that goes stale. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateWorkspaceSettings(
  ctx: WorkspaceContext,
  input: { timezone?: string; weekStart?: number },
): Promise<Result<null>> {
  return withAction(async () => {
    requireRole(ctx, 'owner', 'admin');

    const parsed = z
      .object({ timezone: z.string().optional(), weekStart: z.number().int().min(0).max(6).optional() })
      .safeParse(input);
    if (!parsed.success) return err('Those settings are not valid.');

    if (parsed.data.timezone && !isValidTimezone(parsed.data.timezone)) {
      return err('That is not a recognised timezone.');
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.timezone) patch.timezone = parsed.data.timezone;
    if (parsed.data.weekStart !== undefined) patch.weekStart = parsed.data.weekStart;
    if (Object.keys(patch).length === 0) return ok(null);

    await db
      .update(workspaceSettings).set(patch)
      .where(eq(workspaceSettings.workspaceId, ctx.workspaceId));

    // Due-date rendering everywhere depends on this value.
    revalidatePath(`/${ctx.slug}`, 'layout');
    return ok(null);
  });
}

export async function updateWorkspaceSettingsAction(
  workspaceSlug: string, input: { timezone?: string; weekStart?: number },
): Promise<Result<null>> {
  return withAction(async () =>
    updateWorkspaceSettings(await requireWorkspace(workspaceSlug), input));
}
```

- [ ] **Step 6: Run to verify the tests pass**

```bash
yarn vitest run tests/server/members.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 7: Write the invitation acceptance page**

```tsx
// src/app/(auth)/invite/[invitationId]/page.tsx
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { acceptInvitation } from '@/server/members/actions';

export default async function AcceptInvitePage({
  params,
}: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // Send them to sign up, then straight back here.
  if (!session) redirect(`/sign-up?next=/invite/${invitationId}`);

  const result = await acceptInvitation(session.user.id, session.user.email, invitationId);
  if (result.ok) redirect(`/${result.data.slug}`);

  return (
    <div className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">This invitation cannot be used</h1>
      <p role="alert" className="text-sm text-destructive">{result.error}</p>
      <p className="text-sm text-muted-foreground">
        Ask whoever invited you to send a new one.
      </p>
      <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Go to your workspaces
      </Link>
    </div>
  );
}
```

- [ ] **Step 8: Write the members settings page and its components**

`src/app/(app)/[workspaceSlug]/settings/members/page.tsx`:

```tsx
import { InviteForm } from '@/components/settings/InviteForm';
import { MemberTable } from '@/components/settings/MemberTable';
import { requireWorkspace } from '@/lib/session';
import { listWorkspaceMembers } from '@/server/labels/queries';

export default async function MembersSettingsPage({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const members = await listWorkspaceMembers(ctx);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone here can see and edit every project in this workspace.
        </p>
      </div>

      {canManage && <InviteForm workspaceSlug={workspaceSlug} />}

      <MemberTable
        members={members}
        workspaceSlug={workspaceSlug}
        currentUserId={ctx.userId}
        currentRole={ctx.role}
      />
    </main>
  );
}
```

`src/components/settings/InviteForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { inviteMemberAction } from '@/server/members/actions';

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
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input
            id="invite-email" name="email" type="email" required
            autoComplete="off" placeholder="teammate@example.com"
            aria-describedby={error ? 'invite-error' : undefined}
            className="h-11 text-base"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
            <SelectTrigger id="invite-role" className="h-11 w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" disabled={pending} className="h-11">
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>

      {error && <p id="invite-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Admins can invite and remove people. Members cannot.
      </p>
    </form>
  );
}
```

`src/components/settings/MemberTable.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { changeMemberRoleAction, removeMemberAction } from '@/server/members/actions';
import type { MemberRow } from '@/server/labels/queries';
import type { WorkspaceRole } from '@/lib/session';

export function MemberTable({
  members, workspaceSlug, currentUserId, currentRole,
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
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">Name</th>
          <th scope="col" className="py-2 font-medium">Role</th>
          <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.userId} className="border-b border-border">
            <td className="py-3">
              <div className="font-medium text-foreground">{member.name}</div>
              <div className="text-xs text-muted-foreground">{member.email}</div>
            </td>
            <td className="py-3">
              {currentRole === 'owner' ? (
                <Select
                  value={member.role}
                  disabled={pending}
                  onValueChange={(v) => onRoleChange(member.userId, v as WorkspaceRole)}
                >
                  <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="capitalize text-muted-foreground">{member.role}</span>
              )}
            </td>
            <td className="py-3 text-right">
              {(currentRole === 'owner' || currentRole === 'admin') && member.userId !== currentUserId && (
                <button
                  type="button"
                  onClick={() => onRemove(member)}
                  disabled={pending}
                  className="h-11 rounded-[var(--radius-button)] px-3 text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 9: Write the general settings page with the timezone control**

`src/components/settings/TimezoneForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { updateWorkspaceSettingsAction } from '@/server/settings/actions';

// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
];

export function TimezoneForm({
  workspaceSlug, current, canEdit,
}: { workspaceSlug: string; current: string; canEdit: boolean }) {
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
    <div className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="space-y-2">
        <Label htmlFor="timezone">Workspace timezone</Label>
        <Select value={timezone} onValueChange={setTimezone} disabled={!canEdit || pending}>
          <SelectTrigger id="timezone" className="h-11 w-full sm:w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ZONES.map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Due dates and “today” are calculated in this timezone for everyone in the workspace.
        </p>
      </div>

      {canEdit && (
        <Button onClick={onSave} disabled={pending || timezone === current} className="h-11">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  );
}
```

`src/app/(app)/[workspaceSlug]/settings/general/page.tsx`:

```tsx
import { TimezoneForm } from '@/components/settings/TimezoneForm';
import { requireWorkspace } from '@/lib/session';

export default async function GeneralSettingsPage({
  params,
}: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 pl-16 lg:px-6 lg:pl-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-wide preferences.</p>
      </div>

      <TimezoneForm
        workspaceSlug={workspaceSlug}
        current={ctx.timezone}
        canEdit={ctx.role === 'owner' || ctx.role === 'admin'}
      />
    </main>
  );
}
```

- [ ] **Step 10: Add a settings sub-navigation link**

In `src/components/shell/Rail.tsx`, the Settings link currently points at `/settings/members`. Leave it, and add a second link directly beneath it to `/${workspaceSlug}/settings/general` labelled "General", styled the same way, so both settings pages are reachable.

- [ ] **Step 11: Verify the full invite flow by hand**

```bash
yarn dev
```

As the owner, invite `second@example.com`. With `RESEND_API_KEY` empty, the invite URL is printed to the server console. Open it in a private window, sign up as `second@example.com`, and confirm: you land in the workspace and see the same projects. Then confirm a member cannot see the invite form, and that an owner cannot demote themselves when they are the only owner.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: member invitations, role management, and workspace timezone settings"
```

---

### Task 16: End-to-end tests and CI

Proves the success criteria from spec §1 hold in a real browser, and stops regressions.

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/{auth.spec.ts,board.spec.ts}`, `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: the whole application.
- Produces: `yarn e2e`, a CI workflow.

- [ ] **Step 1: Install Playwright**

```bash
yarn add --exact --dev @playwright/test@1.58.0
yarn playwright install --with-deps chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local' });
process.env.TZ = 'UTC';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'yarn build && yarn start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The e2e run uses the test database, not the development one.
    env: { DATABASE_URL: process.env.DATABASE_URL_TEST!, TZ: 'UTC' },
  },
});
```

- [ ] **Step 3: Write `tests/e2e/auth.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

test('a new user signs up, creates a workspace, and adds a task', async ({ page }) => {
  const email = uniqueEmail('signup');

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/new-workspace/);
  await page.getByLabel('Workspace name').fill('Acme Corp');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/acme-corp/);

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Ship the landing page');
  await page.getByPlaceholder('Add a task…').press('Enter');

  await expect(page.getByText('Ship the landing page')).toBeVisible();
});

test('a workspace slug the user does not belong to returns 404', async ({ page }) => {
  const email = uniqueEmail('outsider');

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Outsider');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/new-workspace/);
  await page.getByLabel('Workspace name').fill('Outsider Space');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/outsider-space/);

  // The slug from the first test exists but belongs to someone else.
  const response = await page.goto('/acme-corp');
  expect(response?.status()).toBe(404);
});
```

- [ ] **Step 4: Write `tests/e2e/board.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';

async function signUpWithProject(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Board Tester');
  await page.getByLabel('Email').fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Workspace name').fill(`Board ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Drag me');
  await page.getByPlaceholder('Add a task…').press('Enter');
  await expect(page.getByText('Drag me')).toBeVisible();
}

test('a card dragged with the pointer stays in its new column after reload', async ({ page }) => {
  await signUpWithProject(page, 'drag');

  await page.getByRole('tab', { name: 'Board' }).click();

  const card = page.getByRole('button', { name: /Drag me/ });
  const inProgress = page.getByRole('region', { name: 'In Progress' });

  await card.hover();
  await page.mouse.down();
  // Two moves: the first clears the 8px activation threshold, the second lands it.
  await page.mouse.move(200, 200, { steps: 10 });
  await inProgress.hover();
  await page.mouse.up();

  await expect(inProgress.getByText('Drag me')).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
});

test('a card can be moved with the keyboard alone', async ({ page }) => {
  await signUpWithProject(page, 'keyboard');

  await page.getByRole('tab', { name: 'Board' }).click();

  await page.getByRole('button', { name: /Drag me/ }).focus();
  await page.keyboard.press('Space');       // lift
  await page.keyboard.press('ArrowRight');  // next column
  await page.keyboard.press('Space');       // drop

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
});

test('a task opened from the board is deep-linkable and closes with back', async ({ page }) => {
  await signUpWithProject(page, 'deeplink');

  await page.getByRole('tab', { name: 'Board' }).click();
  await page.getByRole('button', { name: /Drag me/ }).click();

  await expect(page).toHaveURL(/\?task=/);
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');

  const deepLink = page.url();
  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');

  await page.goto(deepLink);
  await page.goBack();
  await expect(page.getByLabel('Title')).not.toBeVisible();
});
```

- [ ] **Step 5: Run the e2e suite**

```bash
yarn db:up
yarn e2e
```

Expected: 5 tests PASS. If the pointer drag test is flaky, increase the `steps` in `mouse.move` rather than adding a sleep — the flake is dnd-kit not receiving enough intermediate move events, not a timing race.

- [ ] **Step 6: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      TZ: UTC
      DATABASE_URL: postgres://taskeeper:taskeeper@localhost:5432/taskeeper_test
      DATABASE_URL_TEST: postgres://taskeeper:taskeeper@localhost:5432/taskeeper_test
      BETTER_AUTH_SECRET: ci-secret-not-used-in-production
      BETTER_AUTH_URL: http://localhost:3000

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: taskeeper
          POSTGRES_PASSWORD: taskeeper
          POSTGRES_DB: taskeeper_test
          TZ: UTC
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U taskeeper"
          --health-interval 5s --health-timeout 5s --health-retries 10

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Enable corepack
        run: corepack enable

      - name: Install dependencies
        run: yarn install --immutable

      - name: Apply migrations
        run: yarn db:migrate

      - name: Typecheck
        run: yarn typecheck

      - name: Unit and server tests
        run: yarn test

      - name: Install browsers
        run: yarn playwright install --with-deps chromium

      - name: End-to-end tests
        run: yarn e2e
```

`yarn install --immutable` is the CI equivalent of a lockfile check: it fails rather than silently updating `yarn.lock`.

- [ ] **Step 7: Run the whole suite one final time**

```bash
yarn typecheck && yarn test && yarn e2e
```

Expected: typecheck clean, every unit and server test passing, all 5 e2e tests passing. Do not mark this task complete on a partial pass — report exactly which tests fail and why.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: end-to-end coverage for signup, tenancy, and board drag, plus CI"
```

---

## Plan Self-Review

Checked after writing, against the spec.

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §1 success criteria | Tasks 8, 12 (first task fast), 15 (invite flow), 13 (drag persists), 5 + 7 (portable pool) |
| §2 domain model | Task 5 |
| §3.1 better-auth tables | Tasks 5, 6 |
| §3.2 application tables | Task 5 |
| §3.2 RESTRICT note | Tasks 5 (schema test), 9 (`deleteProject` transaction) |
| §3.2 inline label creation | Task 14 |
| §3.3 denormalized `workspace_id` | Task 11 (`createTask` stamps from context; test asserts it) |
| §3.3 fractional positions | Tasks 4, 11 |
| §3.3 `task_status` as table | Tasks 5, 9 |
| §3.4 dates and timezone | Tasks 3, 11, 12, 15 |
| §4 tenancy | Task 7 |
| §4 role table | Tasks 9, 15 |
| §5 app structure | File Structure section; every task follows it |
| §5 mutation contract | Task 7 (`Result`, `withAction`); every action after it |
| §6.1 tokens | Task 2 |
| §6.2 typography | Task 2 |
| §6.3 shell and slide-over | Tasks 10, 14 |
| §6.4 board and keyboard drag | Tasks 13, 16 |
| §6.5 motion and optimistic feedback | Tasks 2, 13 |
| §7 deployment | Tasks 1, 5, 16 |
| §8 testing | Every task; Task 16 for e2e |
| §9 deferred | Not implemented, by design |

Two spec items are deliberately partial, and both are called out rather than silently dropped:

- **Subtasks.** The schema, the `parentTaskId` argument on `createTask`, and the subtask counter on cards and rows all exist and are tested, but there is no UI for adding a subtask from the detail panel. Adding one is a small follow-up task against an interface that is already in place.
- **Status management.** Projects get three seeded statuses and no UI to rename, reorder, or add columns. The spec justifies `task_status` being a table partly on renaming, so this is a gap worth an early follow-up; nothing in the schema blocks it.

**Placeholder scan:** no "TBD", no "add error handling", no "similar to Task N". Every code step carries the actual code.

**Type consistency:** `WorkspaceContext` carries `timezone` from Task 7 onward and every consumer uses it. `TaskRow` is defined once in Task 11 and imported by Tasks 12, 13, and 14. `LabelRow` is defined in Task 11 and re-exported through `src/server/labels/`. `StatusRow` is defined in Task 9 and used in Tasks 11, 12, 13, and 14. `Result<T>`, `ok`, `err`, and `withAction` come from Task 7 and are used unchanged thereafter. `listWorkspaceMembers` is defined in Task 14 and reused by Task 15 — noted there explicitly so it is not defined twice.

One naming point for whoever executes this: `listWorkspaceMembers` lives in `src/server/labels/queries.ts` because the assignee picker needs it before `src/server/members/` exists. If that bothers a reviewer, move it to `src/server/members/queries.ts` in Task 15 and update the two import sites.
