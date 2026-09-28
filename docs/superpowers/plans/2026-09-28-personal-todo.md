# Personal To-do Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, per-workspace To-do page (`/[workspaceSlug]/todo`) where each member keeps a personal checklist: quick add, check off, drag reorder, inline rename, optional due date, delete, and a collapsed "Completed (n)" section.

**Architecture:** New `todo` table (migration 0008) owned by one user in one workspace. `src/server/todos/` follows the statuses pattern: `service.ts` (context-taking, returns `Result`), `queries.ts` (reads), `actions.ts` (slug-taking `'use server'` wrappers + `revalidatePath`). Every read and write filters on `ctx.userId` AND `ctx.workspaceId` — no role check, because no role may see another member's list. The client list is one `useOptimistic` reducer (pure, unit-tested in `src/lib/todo-list.ts`) plus a `@dnd-kit/sortable` list for open items.

**Tech Stack:** Next.js (App Router, Server Actions — read `node_modules/next/dist/docs/` first, see AGENTS.md), Drizzle ORM + Postgres, zod, `fractional-indexing` via `src/lib/position.ts`, `@dnd-kit/core` 6 + `@dnd-kit/sortable` 10, Align UI primitives in `src/components/ui/`, Tabler icons, sonner toasts, Vitest, Playwright.

**Spec:** Claude Doc "Project views & personal to-do — design", section "Personal to-do page" and the to-do lines of "Cleanup & testing" — https://claude.ai/code/artifact/d92c9998-c1b4-4200-9874-b4fbeca69235. The Summary/Board/List half of that spec is already implemented (uncommitted in the working tree) and is **not** part of this plan.

## Global Constraints

- Route: `/[workspaceSlug]/todo`. Table: `todo`. Schema file: `src/db/schema/todo.ts`. Migration: `drizzle/0008_todo.sql`, created via `db:generate` (never hand-written).
- Columns exactly: `id` text PK (`lib/ids`), `user_id` text → `user` cascade, `workspace_id` text → `organization` cascade, `title` text not null, `due_date` date nullable (calendar day in workspace zone), `position` text (fractional index), `completed_at` timestamptz nullable (set = done), `created_at`/`updated_at` timestamptz default now.
- Index: `(user_id, workspace_id, position)`.
- Privacy: every query filters on `ctx.userId` and `ctx.workspaceId` together. No role — owner/admin included — can read or write another member's items.
- Service: `createTodo` appends at the end; `updateTodo` changes title or due date, or toggles done by setting/clearing `completed_at`; `moveTodo` places between two neighbours with `lib/position`; `deleteTodo` removes one. Each returns a `Result`; a missing or foreign row returns a not-found error (`'To-do not found.'` — the codebase uses human messages, e.g. `'Column not found.'`, not error codes).
- `listTodos(ctx)`: open items by `position` asc, done items by `completed_at` desc.
- Actions: slug-taking wrappers using `withAction`, plus `revalidatePath` on the todo route.
- UI: quick-add on top, Enter adds and keeps focus. Open items = sortable `@dnd-kit` list; each row: drag handle, check toggle (same markup/labels as the old `TaskRow`: `Mark "<title>" as done` / `as not done`, `aria-pressed`), inline-editable title (click to edit, Enter/blur saves, Esc cancels), due-date chip picker, hover menu with Delete.
- "Completed (n)" section below, closed by default. Unchecking sends the item to the end of the open list.
- Toggles and reorders are optimistic; on error they roll back and show a toast.
- Rail: "To-do" entry with `IconChecklist`, directly under For you / Recent / Starred.
- Out of scope: notes, sharing, converting a to-do into a task.
- Commits: plain conventional messages (`feat(todo): …`), **no `Co-Authored-By` trailer**. Do not change any package version.

## Review Focus

1. **Blank / oversized titles** — a whitespace-only title (quick add or rename) must be rejected, not stored; renaming to empty reverts to the old title rather than saving `""`. Title max 200 chars. → Task 2 tests + Task 4 `commit()` guard.
2. **Impossible due dates** — `'2026-02-30'` or `'tomorrow'` sent to the action must be rejected, not reach Postgres as a DB error. → Task 2 test.
3. **Stale or hostile move neighbours** — a `beforeId`/`afterId` that belongs to another user, another workspace, a done item, or is out of order must return an error, never a nonsense position or a 500. → Task 2 tests.
4. **Toggle twice quickly** — done → undone → done must leave the item done and in the Completed section with no duplicate rows in the optimistic view. → Task 3 reducer test.
5. **Same user, two workspaces** — a member of two workspaces sees a separate list in each; moving/updating an item via the other workspace's context fails. → Task 2 privacy tests.

---

## Prerequisite (before Task 1)

The working tree holds the uncommitted project-views work on `feat/auth-device-settings`. Ask the user how to land it (commit there, or new branch) before starting; this plan's commits should not be mixed into those files. Then create/switch to the branch the user names (suggested: `feat/personal-todo`).

Also confirm the local databases are up: `yarn db:up`.

---

### Task 1: `todo` table and migration

**Files:**
- Create: `src/db/schema/todo.ts`
- Modify: `src/db/schema/index.ts`
- Create (generated): `drizzle/0008_todo.sql`, `drizzle/meta/0008_snapshot.json`; modified: `drizzle/meta/_journal.json`
- Modify: `tests/setup/db.ts` (truncate list)
- Test: `tests/server/todos.test.ts` (new; first describe block only)

**Interfaces:**
- Produces: `todo` Drizzle table exported from `@/db` with fields `id, userId, workspaceId, title, dueDate (string | null), position, completedAt (Date | null), createdAt, updatedAt`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/todos.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { todo, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';

beforeEach(resetDb);
afterAll(closeDb);

describe('todo table', () => {
  it('stores an item and cascades when its owner is deleted', async () => {
    const ada = await createUser('ada@example.com');
    const ws = await createWorkspace(ada.id, 'Acme', 'acme');

    await db.insert(todo).values({
      id: newId(), userId: ada.id, workspaceId: ws.id, title: 'Buy milk',
      dueDate: '2026-10-01', position: positionBetween(null, null),
    });

    const [row] = await db.select().from(todo);
    expect(row.title).toBe('Buy milk');
    expect(row.dueDate).toBe('2026-10-01');
    expect(row.completedAt).toBeNull();

    await db.delete(user).where(eq(user.id, ada.id));
    expect(await db.select().from(todo)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/server/todos.test.ts`
Expected: FAIL — `todo` is not exported from `@/db` (TypeScript/import error).

- [ ] **Step 3: Add the schema**

Create `src/db/schema/todo.ts`:

```ts
import { date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

/**
 * A member's personal checklist, one list per workspace. Private by
 * construction: nothing links it to tasks, and every read and write filters on
 * user_id and workspace_id together, so no role — owner and admin included —
 * reaches another member's items.
 */
export const todo = pgTable(
  'todo',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // A calendar day in the workspace zone, like task.due_date — never an instant.
    dueDate: date('due_date'),
    position: text('position').notNull(),
    // Set means done. Done items sort by it, newest first.
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('todo_user_workspace_position_idx').on(t.userId, t.workspaceId, t.position)],
);
```

Append to `src/db/schema/index.ts`:

```ts
export * from './todo';
```

In `tests/setup/db.ts`, add `todo` to the front of the TRUNCATE list:

```ts
    TRUNCATE TABLE
      todo, project_star, comment, task_activity,
```

- [ ] **Step 4: Generate and apply the migration**

Run: `yarn db:generate --name todo`
Expected: creates `drizzle/0008_todo.sql` containing `CREATE TABLE "todo"`, two FKs with `ON DELETE cascade`, and `CREATE INDEX "todo_user_workspace_position_idx" … ("user_id","workspace_id","position")`. Read the file and confirm; do not hand-edit it.

Apply to the dev DB and the test DB (drizzle config prefers `DATABASE_URL_DIRECT`, so override that for the test run):

```bash
yarn db:migrate
set -a; . ./.env.local; set +a; DATABASE_URL_DIRECT="$DATABASE_URL_TEST" yarn db:migrate
```

Expected: both report the migration applied.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test tests/server/todos.test.ts tests/server/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/todo.ts src/db/schema/index.ts drizzle/0008_todo.sql drizzle/meta/0008_snapshot.json drizzle/meta/_journal.json tests/setup/db.ts tests/server/todos.test.ts
git commit -m "feat(todo): add personal todo table"
```

---

### Task 2: Todo service and queries

**Files:**
- Create: `src/server/todos/service.ts`
- Create: `src/server/todos/queries.ts`
- Test: `tests/server/todos.test.ts` (append)

**Interfaces:**
- Consumes: `todo` table (Task 1); `WorkspaceContext` from `@/lib/session`; `ok/err/withAction/Result` from `@/lib/result`; `positionBetween` from `@/lib/position`; `newId` from `@/lib/ids`.
- Produces:
  - `type TodoRow = { id: string; title: string; dueDate: string | null; completedAt: Date | null }`
  - `type TodoLists = { open: TodoRow[]; done: TodoRow[] }`
  - `listTodos(ctx: WorkspaceContext): Promise<TodoLists>` (queries.ts)
  - `createTodo(ctx, input: { title: string; dueDate?: string | null }): Promise<Result<{ id: string }>>`
  - `updateTodo(ctx, input: { todoId: string; title?: string; dueDate?: string | null; done?: boolean }): Promise<Result<null>>`
  - `moveTodo(ctx, input: { todoId: string; beforeId: string | null; afterId: string | null }): Promise<Result<{ position: string }>>`
  - `deleteTodo(ctx, input: { todoId: string }): Promise<Result<null>>`
  - Input types `CreateTodoInput`, `UpdateTodoInput`, `MoveTodoInput`, `DeleteTodoInput` (zod `z.input`).

- [ ] **Step 1: Write the failing tests**

Replace the import block at the top of `tests/server/todos.test.ts` with:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { todo, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';
import { listTodos } from '@/server/todos/queries';
import { createTodo, deleteTodo, moveTodo, updateTodo } from '@/server/todos/service';
```

Append below the existing `describe('todo table', …)`:

```ts
const ctxFor = (
  userId: string, workspaceId: string, slug: string, role: WorkspaceContext['role'] = 'owner',
): WorkspaceContext => ({ userId, workspaceId, slug, role, timezone: 'Asia/Yerevan' });

async function owner(email = 'ada@example.com', slug = 'acme') {
  const u = await createUser(email);
  const ws = await createWorkspace(u.id, 'Acme', slug);
  return { user: u, workspace: ws, ctx: ctxFor(u.id, ws.id, slug) };
}

async function add(ctx: WorkspaceContext, title: string) {
  const result = await createTodo(ctx, { title });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

const openTitles = async (ctx: WorkspaceContext) => (await listTodos(ctx)).open.map((t) => t.title);
const doneTitles = async (ctx: WorkspaceContext) => (await listTodos(ctx)).done.map((t) => t.title);

describe('createTodo', () => {
  it('appends to the end of the open list', async () => {
    const { ctx } = await owner();
    await add(ctx, 'One');
    await add(ctx, 'Two');
    await add(ctx, 'Three');
    expect(await openTitles(ctx)).toEqual(['One', 'Two', 'Three']);
  });

  it('trims the title and keeps an optional due date', async () => {
    const { ctx } = await owner();
    await createTodo(ctx, { title: '  Buy milk  ', dueDate: '2026-10-01' });
    const [item] = (await listTodos(ctx)).open;
    expect(item).toMatchObject({ title: 'Buy milk', dueDate: '2026-10-01', completedAt: null });
  });

  it('rejects a blank or oversized title', async () => {
    const { ctx } = await owner();
    expect((await createTodo(ctx, { title: '   ' })).ok).toBe(false);
    expect((await createTodo(ctx, { title: 'x'.repeat(201) })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual([]);
  });

  it('rejects an impossible due date', async () => {
    const { ctx } = await owner();
    expect((await createTodo(ctx, { title: 'A', dueDate: '2026-02-30' })).ok).toBe(false);
    expect((await createTodo(ctx, { title: 'B', dueDate: 'tomorrow' })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual([]);
  });
});

describe('updateTodo', () => {
  it('renames and sets or clears the due date', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'Draft');

    expect((await updateTodo(ctx, { todoId: id, title: 'Final', dueDate: '2026-10-02' })).ok).toBe(true);
    expect((await listTodos(ctx)).open[0]).toMatchObject({ title: 'Final', dueDate: '2026-10-02' });

    expect((await updateTodo(ctx, { todoId: id, dueDate: null })).ok).toBe(true);
    expect((await listTodos(ctx)).open[0].dueDate).toBeNull();
  });

  it('rejects renaming to a blank title', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'Keep me');
    expect((await updateTodo(ctx, { todoId: id, title: '  ' })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual(['Keep me']);
  });

  it('moves a checked item to Completed, newest first', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    await add(ctx, 'C');

    await updateTodo(ctx, { todoId: a, done: true });
    await new Promise((r) => setTimeout(r, 5));
    await updateTodo(ctx, { todoId: b, done: true });

    const lists = await listTodos(ctx);
    expect(lists.open.map((t) => t.title)).toEqual(['C']);
    expect(lists.done.map((t) => t.title)).toEqual(['B', 'A']);
    expect(lists.done[0].completedAt).toBeInstanceOf(Date);
  });

  it('keeps the original completion time when checked again', async () => {
    const { ctx } = await owner();
    const id = await add(ctx, 'A');
    await updateTodo(ctx, { todoId: id, done: true });
    const first = (await listTodos(ctx)).done[0].completedAt;
    await updateTodo(ctx, { todoId: id, done: true });
    expect((await listTodos(ctx)).done[0].completedAt).toEqual(first);
  });

  it('sends an unchecked item to the end of the open list', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    await add(ctx, 'B');
    await add(ctx, 'C');

    await updateTodo(ctx, { todoId: a, done: true });
    await updateTodo(ctx, { todoId: a, done: false });

    expect(await openTitles(ctx)).toEqual(['B', 'C', 'A']);
    expect(await doneTitles(ctx)).toEqual([]);
  });

  it('returns not found for an unknown id', async () => {
    const { ctx } = await owner();
    expect(await updateTodo(ctx, { todoId: 'nope', title: 'X' }))
      .toEqual({ ok: false, error: 'To-do not found.' });
  });
});

describe('moveTodo', () => {
  it('places an item between two neighbours', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    const c = await add(ctx, 'C');

    expect((await moveTodo(ctx, { todoId: c, beforeId: a, afterId: b })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['A', 'C', 'B']);

    expect((await moveTodo(ctx, { todoId: b, beforeId: null, afterId: a })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['B', 'A', 'C']);

    expect((await moveTodo(ctx, { todoId: b, beforeId: c, afterId: null })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['A', 'C', 'B']);
  });

  it('refuses to reorder a completed item', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    await updateTodo(ctx, { todoId: a, done: true });
    expect((await moveTodo(ctx, { todoId: a, beforeId: null, afterId: b })).ok).toBe(false);
  });

  it('refuses a completed, self or out-of-order neighbour', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    const b = await add(ctx, 'B');
    const c = await add(ctx, 'C');
    await updateTodo(ctx, { todoId: a, done: true });

    expect((await moveTodo(ctx, { todoId: c, beforeId: a, afterId: b })).ok).toBe(false);
    expect((await moveTodo(ctx, { todoId: c, beforeId: c, afterId: null })).ok).toBe(false);
    // before must sort ahead of after; a stale client could send them swapped.
    expect((await moveTodo(ctx, { todoId: c, beforeId: b, afterId: b })).ok).toBe(false);
    expect(await openTitles(ctx)).toEqual(['B', 'C']);
  });
});

describe('deleteTodo', () => {
  it('removes one item', async () => {
    const { ctx } = await owner();
    const a = await add(ctx, 'A');
    await add(ctx, 'B');
    expect((await deleteTodo(ctx, { todoId: a })).ok).toBe(true);
    expect(await openTitles(ctx)).toEqual(['B']);
    expect(await deleteTodo(ctx, { todoId: a })).toEqual({ ok: false, error: 'To-do not found.' });
  });
});

describe('privacy', () => {
  it('hides a member’s list from everyone else in the workspace, admins and owners included', async () => {
    const { workspace, ctx: ownerCtx } = await owner();
    const mem = await createUser('mem@example.com');
    await joinWorkspace(mem.id, workspace.id, 'member');
    const memCtx = ctxFor(mem.id, workspace.id, 'acme', 'member');
    const adm = await createUser('adm@example.com');
    await joinWorkspace(adm.id, workspace.id, 'admin');
    const admCtx = ctxFor(adm.id, workspace.id, 'acme', 'admin');

    const secret = await add(memCtx, 'Secret');
    const other = await add(memCtx, 'Other');

    for (const intruder of [ownerCtx, admCtx]) {
      expect(await listTodos(intruder)).toEqual({ open: [], done: [] });
      expect(await updateTodo(intruder, { todoId: secret, title: 'Pwned' }))
        .toEqual({ ok: false, error: 'To-do not found.' });
      expect(await updateTodo(intruder, { todoId: secret, done: true }))
        .toEqual({ ok: false, error: 'To-do not found.' });
      expect((await moveTodo(intruder, { todoId: secret, beforeId: other, afterId: null })).ok).toBe(false);
      expect(await deleteTodo(intruder, { todoId: secret }))
        .toEqual({ ok: false, error: 'To-do not found.' });
    }

    expect(await openTitles(memCtx)).toEqual(['Secret', 'Other']);
  });

  it('refuses another user’s item as a move neighbour', async () => {
    const { workspace, ctx: ownerCtx } = await owner();
    const mem = await createUser('mem@example.com');
    await joinWorkspace(mem.id, workspace.id, 'member');
    const memCtx = ctxFor(mem.id, workspace.id, 'acme', 'member');

    const mine = await add(ownerCtx, 'Mine');
    await add(ownerCtx, 'Also mine');
    const theirs = await add(memCtx, 'Theirs');

    expect((await moveTodo(ownerCtx, { todoId: mine, beforeId: theirs, afterId: null })).ok).toBe(false);
    expect(await openTitles(ownerCtx)).toEqual(['Mine', 'Also mine']);
  });

  it('keeps a separate list per workspace for the same user', async () => {
    const { user: ada, ctx: acme } = await owner();
    const ws2 = await createWorkspace(ada.id, 'Beta', 'beta');
    const beta = ctxFor(ada.id, ws2.id, 'beta');

    const inAcme = await add(acme, 'Acme item');
    await add(beta, 'Beta item');

    expect(await openTitles(acme)).toEqual(['Acme item']);
    expect(await openTitles(beta)).toEqual(['Beta item']);
    expect(await updateTodo(beta, { todoId: inAcme, title: 'Moved?' }))
      .toEqual({ ok: false, error: 'To-do not found.' });
    expect(await deleteTodo(beta, { todoId: inAcme }))
      .toEqual({ ok: false, error: 'To-do not found.' });
  });
});
```

(`eq`, `user`, `newId`, `positionBetween` stay used by the Task 1 block.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test tests/server/todos.test.ts`
Expected: FAIL — cannot resolve `@/server/todos/queries` / `@/server/todos/service`.

- [ ] **Step 3: Write `queries.ts`**

Create `src/server/todos/queries.ts`:

```ts
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, todo } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export type TodoRow = {
  id: string;
  title: string;
  dueDate: string | null;
  completedAt: Date | null;
};

export type TodoLists = { open: TodoRow[]; done: TodoRow[] };

/**
 * The caller's own items in this workspace. Both ids, always: the workspace id
 * alone would show every member's list, and the user id alone would mix a
 * member's workspaces together.
 */
export const ownedBy = (ctx: WorkspaceContext) =>
  and(eq(todo.userId, ctx.userId), eq(todo.workspaceId, ctx.workspaceId));

const columns = {
  id: todo.id,
  title: todo.title,
  dueDate: todo.dueDate,
  completedAt: todo.completedAt,
};

/** Open items in the user's order; done items most recently completed first. */
export async function listTodos(ctx: WorkspaceContext): Promise<TodoLists> {
  const [open, done] = await Promise.all([
    db.select(columns).from(todo)
      .where(and(ownedBy(ctx), isNull(todo.completedAt)))
      .orderBy(asc(todo.position), asc(todo.id)),
    db.select(columns).from(todo)
      .where(and(ownedBy(ctx), isNotNull(todo.completedAt)))
      .orderBy(desc(todo.completedAt), asc(todo.id)),
  ]);
  return { open, done };
}
```

- [ ] **Step 4: Write `service.ts`**

Create `src/server/todos/service.ts`:

```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, todo } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { ownedBy } from './queries';

/**
 * A personal checklist, so there is no requireRole anywhere: the owner is the
 * only reader and writer, and ownedBy() is in every WHERE. A row that exists
 * but belongs to someone else is reported exactly like a missing one.
 */

const NOT_FOUND = 'To-do not found.';
const BAD_MOVE = 'That move is not valid.';

const titleSchema = z
  .string().trim().min(1, 'Name the to-do.').max(200, 'Keep it under 200 characters.');

/** 'YYYY-MM-DD' that is also a real calendar day — Postgres would throw on 2026-02-30. */
const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'That date is not valid.')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'That date is not valid.')
  .nullable();

async function lastOpenPosition(ctx: WorkspaceContext): Promise<string | null> {
  const [last] = await db
    .select({ position: todo.position })
    .from(todo)
    .where(and(ownedBy(ctx), isNull(todo.completedAt)))
    .orderBy(desc(todo.position))
    .limit(1);
  return last?.position ?? null;
}

export const createTodoSchema = z.object({
  title: titleSchema,
  dueDate: dueDateSchema.optional(),
});

export type CreateTodoInput = z.input<typeof createTodoSchema>;

/** Appends to the end of the open list. */
export async function createTodo(
  ctx: WorkspaceContext,
  input: CreateTodoInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = createTodoSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const id = newId();
    await db.insert(todo).values({
      id,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ?? null,
      position: positionBetween(await lastOpenPosition(ctx), null),
    });
    return ok({ id });
  });
}

export const updateTodoSchema = z.object({
  todoId: z.string().min(1),
  title: titleSchema.optional(),
  dueDate: dueDateSchema.optional(),
  done: z.boolean().optional(),
});

export type UpdateTodoInput = z.input<typeof updateTodoSchema>;

/**
 * Renames, re-dates, or toggles done. Checking sets completed_at (kept if
 * already set, so a double click does not reshuffle Completed); unchecking
 * clears it and sends the item to the end of the open list.
 */
export async function updateTodo(
  ctx: WorkspaceContext,
  input: UpdateTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = updateTodoSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);
    const { todoId, title, dueDate, done } = parsed.data;

    const [current] = await db
      .select({ completedAt: todo.completedAt })
      .from(todo)
      .where(and(eq(todo.id, todoId), ownedBy(ctx)))
      .limit(1);
    if (!current) return err(NOT_FOUND);

    const patch: Partial<typeof todo.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (dueDate !== undefined) patch.dueDate = dueDate;
    if (done === true && !current.completedAt) patch.completedAt = new Date();
    if (done === false && current.completedAt) {
      patch.completedAt = null;
      patch.position = positionBetween(await lastOpenPosition(ctx), null);
    }

    await db.update(todo).set(patch).where(and(eq(todo.id, todoId), ownedBy(ctx)));
    return ok(null);
  });
}

export const moveTodoSchema = z.object({
  todoId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type MoveTodoInput = z.input<typeof moveTodoSchema>;

/**
 * Reorders an open item. As with a board drop, the client sends the neighbours
 * it saw and the server computes the key. Neighbours must be the caller's own
 * open items, and in order — anything else is a stale or forged move.
 */
export async function moveTodo(
  ctx: WorkspaceContext,
  input: MoveTodoInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const parsed = moveTodoSchema.safeParse(input);
    if (!parsed.success) return err(BAD_MOVE);
    const { todoId, beforeId, afterId } = parsed.data;

    const [moving] = await db
      .select({ completedAt: todo.completedAt })
      .from(todo)
      .where(and(eq(todo.id, todoId), ownedBy(ctx)))
      .limit(1);
    if (!moving) return err(NOT_FOUND);
    if (moving.completedAt) return err('Completed to-dos cannot be reordered.');

    // null = list edge; undefined = not a valid neighbour.
    const neighbour = async (id: string | null): Promise<string | null | undefined> => {
      if (id === null) return null;
      if (id === todoId) return undefined;
      const [row] = await db
        .select({ position: todo.position })
        .from(todo)
        .where(and(eq(todo.id, id), ownedBy(ctx), isNull(todo.completedAt)))
        .limit(1);
      return row?.position;
    };

    const [before, after] = await Promise.all([neighbour(beforeId), neighbour(afterId)]);
    if (before === undefined || after === undefined) return err(BAD_MOVE);
    // generateKeyBetween throws unless before < after.
    if (before !== null && after !== null && before >= after) return err(BAD_MOVE);

    const position = positionBetween(before, after);
    await db
      .update(todo)
      .set({ position, updatedAt: new Date() })
      .where(and(eq(todo.id, todoId), ownedBy(ctx)));
    return ok({ position });
  });
}

export const deleteTodoSchema = z.object({ todoId: z.string().min(1) });

export type DeleteTodoInput = z.input<typeof deleteTodoSchema>;

export async function deleteTodo(
  ctx: WorkspaceContext,
  input: DeleteTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = deleteTodoSchema.safeParse(input);
    if (!parsed.success) return err(NOT_FOUND);

    const deleted = await db
      .delete(todo)
      .where(and(eq(todo.id, parsed.data.todoId), ownedBy(ctx)))
      .returning({ id: todo.id });
    return deleted.length > 0 ? ok(null) : err(NOT_FOUND);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test tests/server/todos.test.ts`
Expected: PASS (all describes).

- [ ] **Step 6: Typecheck and commit**

Run: `yarn typecheck`
Expected: no errors.

```bash
git add src/server/todos/service.ts src/server/todos/queries.ts tests/server/todos.test.ts
git commit -m "feat(todo): personal todo service and queries"
```

---

### Task 3: Pure list helpers (optimistic reducer + drop neighbours)

**Files:**
- Create: `src/lib/todo-list.ts`
- Test: `tests/unit/todo-list.test.ts`

**Interfaces:**
- Consumes: `TodoRow`, `TodoLists` types from `@/server/todos/queries` (type-only import, safe in client code).
- Produces:
  - `type TodoOp = { kind: 'toggle'; id: string; done: boolean; now: Date } | { kind: 'move'; id: string; toIndex: number } | { kind: 'edit'; id: string; title?: string; dueDate?: string | null } | { kind: 'delete'; id: string }`
  - `applyTodoOp(lists: TodoLists, op: TodoOp): TodoLists`
  - `dropTarget(ids: string[], activeId: string, overId: string): { toIndex: number; beforeId: string | null; afterId: string | null } | null`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/todo-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyTodoOp, dropTarget } from '@/lib/todo-list';
import type { TodoLists, TodoRow } from '@/server/todos/queries';

const row = (id: string, completedAt: Date | null = null): TodoRow =>
  ({ id, title: id.toUpperCase(), dueDate: null, completedAt });

const lists = (open: string[], done: string[] = []): TodoLists => ({
  open: open.map((id) => row(id)),
  done: done.map((id) => row(id, new Date('2026-09-01T00:00:00Z'))),
});

const ids = (l: TodoLists) => ({ open: l.open.map((t) => t.id), done: l.done.map((t) => t.id) });
const now = new Date('2026-09-28T10:00:00Z');

describe('applyTodoOp', () => {
  it('checking moves the item to the top of done', () => {
    const next = applyTodoOp(lists(['a', 'b'], ['z']), { kind: 'toggle', id: 'a', done: true, now });
    expect(ids(next)).toEqual({ open: ['b'], done: ['a', 'z'] });
    expect(next.done[0].completedAt).toEqual(now);
  });

  it('unchecking moves the item to the end of open', () => {
    const next = applyTodoOp(lists(['a'], ['z', 'y']), { kind: 'toggle', id: 'y', done: false, now });
    expect(ids(next)).toEqual({ open: ['a', 'y'], done: ['z'] });
    expect(next.open[1].completedAt).toBeNull();
  });

  it('toggling twice quickly never duplicates the item', () => {
    let l = lists(['a', 'b']);
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: true, now });
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: false, now });
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: true, now });
    expect(ids(l)).toEqual({ open: ['b'], done: ['a'] });
  });

  it('a toggle that is already applied is a no-op', () => {
    const start = lists(['a'], ['z']);
    expect(applyTodoOp(start, { kind: 'toggle', id: 'z', done: true, now })).toBe(start);
    expect(applyTodoOp(start, { kind: 'toggle', id: 'a', done: false, now })).toBe(start);
  });

  it('moves an open item to an index', () => {
    const next = applyTodoOp(lists(['a', 'b', 'c']), { kind: 'move', id: 'c', toIndex: 0 });
    expect(ids(next).open).toEqual(['c', 'a', 'b']);
  });

  it('edits title and due date in either list', () => {
    let l = lists(['a'], ['z']);
    l = applyTodoOp(l, { kind: 'edit', id: 'a', title: 'New' });
    l = applyTodoOp(l, { kind: 'edit', id: 'z', dueDate: '2026-10-01' });
    expect(l.open[0].title).toBe('New');
    expect(l.done[0].dueDate).toBe('2026-10-01');
  });

  it('deletes from either list', () => {
    const next = applyTodoOp(
      applyTodoOp(lists(['a', 'b'], ['z']), { kind: 'delete', id: 'a' }),
      { kind: 'delete', id: 'z' },
    );
    expect(ids(next)).toEqual({ open: ['b'], done: [] });
  });
});

describe('dropTarget', () => {
  it('moving down lands after the item dropped on', () => {
    expect(dropTarget(['a', 'b', 'c'], 'a', 'b')).toEqual({ toIndex: 1, beforeId: 'b', afterId: 'c' });
  });

  it('moving up lands before the item dropped on', () => {
    expect(dropTarget(['a', 'b', 'c'], 'c', 'a')).toEqual({ toIndex: 0, beforeId: null, afterId: 'a' });
  });

  it('moving to the end has no after neighbour', () => {
    expect(dropTarget(['a', 'b', 'c'], 'a', 'c')).toEqual({ toIndex: 2, beforeId: 'c', afterId: null });
  });

  it('dropping on itself or an unknown id is no move', () => {
    expect(dropTarget(['a', 'b'], 'a', 'a')).toBeNull();
    expect(dropTarget(['a', 'b'], 'a', 'zzz')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test tests/unit/todo-list.test.ts`
Expected: FAIL — cannot resolve `@/lib/todo-list`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/todo-list.ts`:

```ts
import { arrayMove } from '@dnd-kit/sortable';
import type { TodoLists, TodoRow } from '@/server/todos/queries';

/**
 * Client-side mirrors of the todo service, for useOptimistic. They only need to
 * match what the server will show after revalidation closely enough that the
 * swap is invisible: open items in list order, done items newest first, an
 * unchecked item at the end of open.
 */
export type TodoOp =
  | { kind: 'toggle'; id: string; done: boolean; now: Date }
  | { kind: 'move'; id: string; toIndex: number }
  | { kind: 'edit'; id: string; title?: string; dueDate?: string | null }
  | { kind: 'delete'; id: string };

export function applyTodoOp(lists: TodoLists, op: TodoOp): TodoLists {
  switch (op.kind) {
    case 'toggle': {
      const from = op.done ? lists.open : lists.done;
      const item = from.find((t) => t.id === op.id);
      if (!item) return lists;
      const rest = from.filter((t) => t.id !== op.id);
      return op.done
        ? { open: rest, done: [{ ...item, completedAt: op.now }, ...lists.done] }
        : { open: [...lists.open, { ...item, completedAt: null }], done: rest };
    }
    case 'move': {
      const from = lists.open.findIndex((t) => t.id === op.id);
      if (from === -1) return lists;
      return { ...lists, open: arrayMove(lists.open, from, op.toIndex) };
    }
    case 'edit': {
      const patch = (t: TodoRow): TodoRow =>
        t.id !== op.id
          ? t
          : {
              ...t,
              ...(op.title !== undefined && { title: op.title }),
              ...(op.dueDate !== undefined && { dueDate: op.dueDate }),
            };
      return { open: lists.open.map(patch), done: lists.done.map(patch) };
    }
    case 'delete':
      return {
        open: lists.open.filter((t) => t.id !== op.id),
        done: lists.done.filter((t) => t.id !== op.id),
      };
  }
}

/**
 * Where a dragged item lands when dropped on another, in the shape moveTodo
 * needs: neighbour ids, never a position, so the server computes the key.
 */
export function dropTarget(ids: string[], activeId: string, overId: string) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;

  const next = arrayMove(ids, from, to);
  return {
    toIndex: to,
    beforeId: next[to - 1] ?? null,
    afterId: next[to + 1] ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test tests/unit/todo-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/todo-list.ts tests/unit/todo-list.test.ts
git commit -m "feat(todo): optimistic list helpers"
```

---

### Task 4: Actions, page and To-do UI

**Files:**
- Create: `src/server/todos/actions.ts`
- Create: `src/app/(app)/[workspaceSlug]/todo/page.tsx`
- Create: `src/components/todo/TodoList.tsx`
- Create: `src/components/todo/TodoItem.tsx`
- Create: `src/components/todo/TodoQuickAdd.tsx`
- Create: `src/components/todo/TodoDuePicker.tsx`

**Interfaces:**
- Consumes: service functions + input types (Task 2), `listTodos`/`TodoRow`/`TodoLists` (Task 2), `applyTodoOp`/`TodoOp`/`dropTarget` (Task 3), `requireWorkspace` from `@/lib/session`, `DueChip` from `@/components/task/DueChip`, `* as Popover` from `@/components/ui/popover`, `* as Dropdown` from `@/components/ui/dropdown`, `* as CompactButton` from `@/components/ui/compact-button`.
- Produces:
  - `createTodoAction(slug, CreateTodoInput): Promise<Result<{ id: string }>>`
  - `updateTodoAction(slug, UpdateTodoInput): Promise<Result<null>>`
  - `moveTodoAction(slug, MoveTodoInput): Promise<Result<{ position: string }>>`
  - `deleteTodoAction(slug, DeleteTodoInput): Promise<Result<null>>`
  - Accessible names the E2E test (Task 5) relies on: heading `To-do`; input placeholder `Add a to-do…`; `list` named `Open to-dos` / `Completed to-dos`; drag handle `Reorder "<title>"`; toggle `Mark "<title>" as done` / `Mark "<title>" as not done`; section toggle button `Completed (<n>)`; title element carries `data-todo-title`.

Before writing: read the Server Actions / `revalidatePath` / `useOptimistic` guidance under `node_modules/next/dist/docs/` (AGENTS.md requires it). The pattern this task relies on: an action that calls `revalidatePath` returns the refreshed RSC payload in the same round trip, so inside a `startTransition` the optimistic state settles onto fresh server props on success, and on failure (props unchanged) falls back to them — that fallback *is* the rollback.

- [ ] **Step 1: Write the actions**

Create `src/server/todos/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import {
  createTodo, deleteTodo, moveTodo, updateTodo,
  type CreateTodoInput, type DeleteTodoInput, type MoveTodoInput, type UpdateTodoInput,
} from './service';

/**
 * Slug-taking wrappers: the workspace and the user both come from the session
 * plus the slug, never from the client. Only the to-do page shows these rows,
 * so revalidation is that one route.
 */

const todoPath = (workspaceSlug: string) => `/${workspaceSlug}/todo`;

export async function createTodoAction(
  workspaceSlug: string,
  input: CreateTodoInput,
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function updateTodoAction(
  workspaceSlug: string,
  input: UpdateTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function moveTodoAction(
  workspaceSlug: string,
  input: MoveTodoInput,
): Promise<Result<{ position: string }>> {
  return withAction(async () => {
    const result = await moveTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}

export async function deleteTodoAction(
  workspaceSlug: string,
  input: DeleteTodoInput,
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteTodo(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidatePath(todoPath(workspaceSlug));
    return result;
  });
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/[workspaceSlug]/todo/page.tsx`:

```tsx
import { TodoList } from '@/components/todo/TodoList';
import { requireWorkspace } from '@/lib/session';
import { listTodos } from '@/server/todos/queries';

export default async function TodoPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const lists = await listTodos(ctx);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <h1 className="text-title-h5 text-text-strong-950">To-do</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Your personal checklist for this workspace. Only you can see it.
      </p>
      <TodoList workspaceSlug={workspaceSlug} timezone={ctx.timezone} lists={lists} />
    </main>
  );
}
```

- [ ] **Step 3: Write the quick-add**

Create `src/components/todo/TodoQuickAdd.tsx`:

```tsx
'use client';

import { IconPlus } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { createTodoAction } from '@/server/todos/actions';

export function TodoQuickAdd({ workspaceSlug }: { workspaceSlug: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = inputRef.current?.value.trim();
    if (!title) return;

    // Same rules as QuickAddTask: clear first and never disable, so focus stays
    // in the field and the next item can be typed straight away.
    if (inputRef.current) inputRef.current.value = '';

    setPending(true);
    const result = await createTodoAction(workspaceSlug, { title });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative flex items-center gap-2 rounded-xl bg-bg-white-0 px-3 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 focus-within:ring-primary-base"
    >
      <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
      <label htmlFor="todo-quick-add" className="sr-only">Add a to-do</label>
      <input
        id="todo-quick-add"
        ref={inputRef}
        name="title"
        maxLength={200}
        aria-busy={pending}
        placeholder="Add a to-do…"
        className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:text-paragraph-sm"
      />
    </form>
  );
}
```

- [ ] **Step 4: Write the due-date picker**

Create `src/components/todo/TodoDuePicker.tsx`:

```tsx
'use client';

import { IconCalendarPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { DueChip } from '@/components/task/DueChip';
import * as Popover from '@/components/ui/popover';

export function TodoDuePicker({
  title,
  dueDate,
  timezone,
  onChange,
}: {
  title: string;
  dueDate: string | null;
  timezone: string;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(value: string | null) {
    setOpen(false);
    if (value !== dueDate) onChange(value);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={dueDate ? `Change due date of "${title}"` : `Set due date for "${title}"`}
        className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-text-soft-400 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950 data-[state=open]:bg-bg-weak-50"
      >
        {dueDate
          ? <DueChip dueDate={dueDate} timezone={timezone} />
          : <IconCalendarPlus className="size-4" aria-hidden="true" />}
      </Popover.Trigger>
      <Popover.Content align="end" className="w-60 space-y-2 p-3">
        <label htmlFor="todo-due" className="text-label-sm text-text-strong-950">Due date</label>
        <input
          id="todo-due"
          type="date"
          defaultValue={dueDate ?? ''}
          // A native date input only fires change with a complete, valid day.
          onChange={(e) => { if (e.target.value) pick(e.target.value); }}
          className="h-9 w-full rounded-lg bg-bg-white-0 px-2 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="text-label-xs text-text-sub-600 hover:text-error-base"
          >
            Clear due date
          </button>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
```

- [ ] **Step 5: Write the row**

Create `src/components/todo/TodoItem.tsx`:

```tsx
'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconCircle, IconCircleCheckFilled, IconDots, IconGripVertical, IconTrash,
} from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { TodoDuePicker } from '@/components/todo/TodoDuePicker';
import * as CompactButton from '@/components/ui/compact-button';
import * as Dropdown from '@/components/ui/dropdown';
import type { TodoRow } from '@/server/todos/queries';
import { cn } from '@/utils/cn';

export type TodoItemHandlers = {
  onToggle: (item: TodoRow) => void;
  onRename: (item: TodoRow, title: string) => void;
  onDue: (item: TodoRow, dueDate: string | null) => void;
  onDelete: (item: TodoRow) => void;
};

type RowProps = TodoItemHandlers & {
  item: TodoRow;
  timezone: string;
  handle?: React.ReactNode;
  rowRef?: (node: HTMLLIElement | null) => void;
  style?: React.CSSProperties;
  dragging?: boolean;
};

/** A completed row, or the body of a sortable one. */
export function TodoItem({
  item, timezone, handle, rowRef, style, dragging, onToggle, onRename, onDue, onDelete,
}: RowProps) {
  const done = item.completedAt !== null;
  const [editing, setEditing] = useState(false);
  // Enter commits and then unmounts the input, which fires blur: commit once.
  const settled = useRef(false);

  function startEdit() {
    settled.current = false;
    setEditing(true);
  }

  function commit(value: string) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const title = value.trim();
    // Blank or unchanged: revert rather than save.
    if (title && title !== item.title) onRename(item, title);
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
  }

  return (
    <li
      ref={rowRef}
      style={style}
      className={cn(
        'group flex items-center gap-1 border-b border-stroke-soft-200 bg-bg-white-0 px-1 transition-colors duration-150 last:border-b-0 hover:bg-bg-weak-50',
        dragging && 'relative z-10 shadow-regular-md',
      )}
    >
      {handle}

      {/* A toggle button, not a checkbox — same markup and names as the old TaskRow. */}
      <button
        type="button"
        onClick={() => onToggle(item)}
        aria-pressed={done}
        aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950"
      >
        {done
          ? <IconCircleCheckFilled className="size-5 text-success-base" aria-hidden="true" />
          : <IconCircle className="size-5" aria-hidden="true" />}
      </button>

      {editing ? (
        <input
          autoFocus
          defaultValue={item.title}
          maxLength={200}
          aria-label={`Rename "${item.title}"`}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="h-9 min-w-0 flex-1 rounded-md bg-bg-white-0 px-2 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-primary-base"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="flex min-h-11 min-w-0 flex-1 items-center py-2 text-left"
        >
          <span
            data-todo-title
            className={cn(
              'min-w-0 flex-1 truncate text-paragraph-sm',
              done ? 'text-text-soft-400 line-through' : 'text-text-strong-950',
            )}
          >
            {item.title}
          </span>
        </button>
      )}

      <TodoDuePicker
        title={item.title}
        dueDate={item.dueDate}
        timezone={timezone}
        onChange={(dueDate) => onDue(item, dueDate)}
      />

      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <CompactButton.Root
            variant="ghost"
            size="large"
            aria-label={`More actions for "${item.title}"`}
            // Always visible on touch screens, hover-revealed on desktop.
            className="shrink-0 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100"
          >
            <CompactButton.Icon as={IconDots} />
          </CompactButton.Root>
        </Dropdown.Trigger>
        <Dropdown.Content align="end" className="w-40">
          <Dropdown.Item onSelect={() => onDelete(item)} className="text-error-base">
            <Dropdown.ItemIcon as={IconTrash} />
            Delete
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Root>
    </li>
  );
}

/** An open row: the whole row moves, but only the handle starts a drag. */
export function SortableTodoItem(props: TodoItemHandlers & { item: TodoRow; timezone: string }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.item.id });

  return (
    <TodoItem
      {...props}
      rowRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder "${props.item.title}"`}
          // touch-none: without it a touch on the handle scrolls instead of dragging.
          className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-text-soft-400 hover:text-text-strong-950 active:cursor-grabbing"
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      }
    />
  );
}
```

If `CompactButton`'s `size`/`variant` names or `Dropdown.ItemIcon` props differ from the above, match the usages in `src/components/shell/Rail.tsx` (`MobileNav`) and `src/components/ui/dropdown.tsx` rather than guessing.

- [ ] **Step 6: Write the list**

Create `src/components/todo/TodoList.tsx`:

```tsx
'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { IconChecklist, IconChevronRight } from '@tabler/icons-react';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { SortableTodoItem, TodoItem, type TodoItemHandlers } from '@/components/todo/TodoItem';
import { TodoQuickAdd } from '@/components/todo/TodoQuickAdd';
import type { Result } from '@/lib/result';
import { applyTodoOp, dropTarget, type TodoOp } from '@/lib/todo-list';
import {
  deleteTodoAction, moveTodoAction, updateTodoAction,
} from '@/server/todos/actions';
import type { TodoLists } from '@/server/todos/queries';
import { cn } from '@/utils/cn';

export function TodoList({
  workspaceSlug,
  timezone,
  lists,
}: {
  workspaceSlug: string;
  timezone: string;
  lists: TodoLists;
}) {
  const [view, apply] = useOptimistic(lists, applyTodoOp);
  const [, startTransition] = useTransition();
  const [showDone, setShowDone] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Optimistic first, server second. On success the action's revalidatePath
   * delivers fresh props in the same transition; on failure the props are
   * unchanged, so dropping the optimistic layer is the rollback.
   */
  function run(op: TodoOp, call: () => Promise<Result<unknown>>) {
    startTransition(async () => {
      apply(op);
      const result = await call();
      if (!result.ok) toast.error(result.error);
    });
  }

  const handlers: TodoItemHandlers = {
    onToggle: (item) => {
      const done = item.completedAt === null;
      run({ kind: 'toggle', id: item.id, done, now: new Date() },
        () => updateTodoAction(workspaceSlug, { todoId: item.id, done }));
    },
    onRename: (item, title) =>
      run({ kind: 'edit', id: item.id, title },
        () => updateTodoAction(workspaceSlug, { todoId: item.id, title })),
    onDue: (item, dueDate) =>
      run({ kind: 'edit', id: item.id, dueDate },
        () => updateTodoAction(workspaceSlug, { todoId: item.id, dueDate })),
    onDelete: (item) =>
      run({ kind: 'delete', id: item.id },
        () => deleteTodoAction(workspaceSlug, { todoId: item.id })),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const id = String(active.id);
    const target = dropTarget(view.open.map((t) => t.id), id, String(over.id));
    if (!target) return;
    run({ kind: 'move', id, toIndex: target.toIndex },
      () => moveTodoAction(workspaceSlug, { todoId: id, beforeId: target.beforeId, afterId: target.afterId }));
  }

  const empty = view.open.length === 0 && view.done.length === 0;

  return (
    <div className="mt-6 space-y-6">
      <TodoQuickAdd workspaceSlug={workspaceSlug} />

      {empty ? (
        <div className="flex flex-col items-center rounded-20 border border-dashed border-stroke-sub-300 px-8 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-lighter text-primary-base ring-1 ring-inset ring-primary-alpha-16">
            <IconChecklist className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 text-label-sm text-text-strong-950">Nothing to do</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Type above and press Enter to add your first item.
          </p>
        </div>
      ) : (
        view.open.length > 0 && (
          // An explicit id: dnd-kit's generated aria ids otherwise differ between
          // server and browser render (see Board.tsx).
          <DndContext id="todo-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={view.open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul
                aria-label="Open to-dos"
                className="overflow-hidden rounded-xl bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200"
              >
                {view.open.map((item) => (
                  <SortableTodoItem key={item.id} item={item} timezone={timezone} {...handlers} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )
      )}

      {view.done.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls="todo-completed"
            onClick={() => setShowDone((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-label-sm text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
          >
            <IconChevronRight
              className={cn('size-4 transition-transform duration-150', showDone && 'rotate-90')}
              aria-hidden="true"
            />
            Completed ({view.done.length})
          </button>
          {showDone && (
            <ul
              id="todo-completed"
              aria-label="Completed to-dos"
              className="mt-2 overflow-hidden rounded-xl bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200"
            >
              {view.done.map((item) => (
                <TodoItem
                  key={item.id}
                  item={item}
                  timezone={timezone}
                  // Keeps the title column aligned with the open list's handle.
                  handle={<span className="size-9 shrink-0" aria-hidden="true" />}
                  {...handlers}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, lint, unit/server tests**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all pass. Fix any prop-name mismatch against the real Align primitives (see note after Step 5).

- [ ] **Step 8: Verify in the running app**

Use the `run` skill (or `yarn dev`), sign in, open `/<slug>/todo` directly. Check: add three items (focus stays in the field), click a title → rename with Enter, rename to blank → reverts, Esc cancels; set and clear a due date; drag by the handle to reorder and reload — order persists; check an item → "Completed (1)" appears, expand, uncheck → item returns at the end; Delete from the ⋯ menu. Check the page at 375px width: no horizontal scroll, ⋯ visible.

- [ ] **Step 9: Commit**

```bash
git add src/server/todos/actions.ts "src/app/(app)/[workspaceSlug]/todo/page.tsx" src/components/todo/
git commit -m "feat(todo): personal to-do page"
```

---

### Task 5: Rail entry and E2E

**Files:**
- Modify: `src/components/shell/Rail.tsx` (imports + `views` array in `RailBody`)
- Create: `tests/e2e/todo.spec.ts`

**Interfaces:**
- Consumes: accessible names listed in Task 4's Produces.

- [ ] **Step 1: Write the failing E2E test**

Create `tests/e2e/todo.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Todo Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Todo ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
}

const openList = (page: Page) => page.getByRole('list', { name: 'Open to-dos' });
const openTitles = (page: Page) => openList(page).locator('[data-todo-title]');

test('a to-do can be added, reordered, checked and restored from Completed', async ({ page }) => {
  await signUp(page, 'todo');

  await page.getByRole('link', { name: 'To-do' }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await expect(page.getByRole('heading', { name: 'To-do' })).toBeVisible();

  const add = page.getByPlaceholder('Add a to-do…');
  for (const title of ['Buy milk', 'Call Ada', 'File taxes']) {
    await add.fill(title);
    await add.press('Enter');
    await expect(openTitles(page).filter({ hasText: title })).toBeVisible();
  }
  await expect(add).toBeFocused();
  await expect(openTitles(page)).toHaveText(['Buy milk', 'Call Ada', 'File taxes']);

  // Keyboard drag: Space lifts, arrows move, Space drops.
  await page.getByRole('button', { name: 'Reorder "File taxes"' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(openTitles(page)).toHaveText(['File taxes', 'Buy milk', 'Call Ada']);

  await page.reload();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Buy milk', 'Call Ada']);

  await page.getByRole('button', { name: 'Mark "Buy milk" as done' }).click();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada']);

  const completed = page.getByRole('button', { name: 'Completed (1)' });
  await expect(completed).toHaveAttribute('aria-expanded', 'false');
  await completed.click();

  await page
    .getByRole('list', { name: 'Completed to-dos' })
    .getByRole('button', { name: 'Mark "Buy milk" as not done' })
    .click();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada', 'Buy milk']);
  await expect(page.getByRole('button', { name: /^Completed/ })).toHaveCount(0);

  await page.reload();
  await expect(openTitles(page)).toHaveText(['File taxes', 'Call Ada', 'Buy milk']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn e2e tests/e2e/todo.spec.ts`
Expected: FAIL at `getByRole('link', { name: 'To-do' })` — no rail entry yet. (The first run builds the app; allow a few minutes.)

- [ ] **Step 3: Add the rail entry**

In `src/components/shell/Rail.tsx`, add `IconChecklist` to the Tabler import:

```ts
import {
  IconChecklist, IconClock, IconClockFilled, IconMenu2, IconSparkles, IconStar, IconStarFilled,
} from '@tabler/icons-react';
```

and append to the `views` array in `RailBody`, after Starred:

```ts
    { href: `/${workspaceSlug}/todo`, label: 'To-do', icon: IconChecklist, activeIcon: IconChecklist },
```

- [ ] **Step 4: Run E2E to verify it passes, then the whole suite**

Run: `yarn e2e tests/e2e/todo.spec.ts`
Expected: PASS.

Run: `yarn typecheck && yarn lint && yarn test && yarn e2e`
Expected: all pass (existing board/auth/comments specs unaffected).

- [ ] **Step 5: Update the knowledge graph and commit**

Run: `graphify update .`

```bash
git add src/components/shell/Rail.tsx tests/e2e/todo.spec.ts
git commit -m "feat(todo): rail entry and e2e coverage"
```
