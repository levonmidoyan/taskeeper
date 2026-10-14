# Subtasks UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subtasks intuitive: rich editable rows with a stable, draggable order, an always-visible add field with paste-to-many, clear navigation when a subtask is opened, subtasks visible from board cards and list rows, and converting tasks to subtasks and back.

**Architecture:** A new nullable `task.subtask_position` fractional key orders subtasks inside their parent, independent of the per-column `position` (so status changes stop reshuffling the list). Three new service functions (`createSubtasks`, `reorderSubtask`, `setTaskParent`) follow the existing neighbour-not-position and lock-then-read patterns, wrapped by slug-taking server actions. UI work rebuilds `SubtaskSection` around dnd-kit sortable rows that reuse `TaskFieldItems` and `AssigneePicker`, adds a sibling banner to the detail view, a `footer` slot to `KanbanCard` for a board checklist, and child rows to `TaskTable`.

**Tech Stack:** Next.js (see AGENTS.md — read `node_modules/next/dist/docs/` before touching Next APIs), React 19, Drizzle ORM on Postgres (`drizzle-kit push` + `src/db/sql/*.sql`), zod, dnd-kit, `fractional-indexing` via `@/lib/position`, Vitest (DB tests in `tests/server`, pure tests in `tests/unit`), Playwright e2e in `tests/e2e`.

**Spec:** `docs/superpowers/specs/2026-10-14-subtasks-ux-design.md`

## Global Constraints

- Depth stays one level: a subtask never has subtasks; a task with subtasks never becomes a subtask (`"Tasks with subtasks can’t become subtasks."`).
- A subtask's parent is in the same project and workspace, top-level and not archived.
- `subtaskPosition` is set on every subtask and `null` on every top-level task. Status changes never touch it.
- Order reads are always `ORDER BY byKey(task.subtaskPosition), byId(task.id)`.
- Bulk add cap: 50 titles per call (`"Up to 50 at a time."`); titles trimmed, empties dropped, max 200 chars each.
- Reorder: the client sends neighbours (`beforeId`, `afterId`), never a key. Reversed neighbours → `'The list changed while you were dragging. Try again.'`; non-sibling neighbour → `'That move is not valid.'`.
- Server actions live in `src/server/tasks/actions.ts`, take `workspaceSlug` first, call `requireWorkspace`, and `revalidateWorkspace` on success. Never accept a `WorkspaceContext` from the client.
- Every write emits `emitChange(ctx, { projectId }, tx)` inside its transaction so live refresh fires.
- New shortcuts: `[` previous sibling, `]` next sibling, `u` parent — scope `detail`, group `Task`.
- Escape inside the detail dialog uses the `data-local-escape` + `LOCAL_ESCAPE_EVENT` hand-off (see current `SubtaskSection.tsx`).
- Copy uses typographic quotes/apostrophes as the rest of the app (`’`, `“ ”`, `…`).
- Commits: plain conventional messages, **no `Co-Authored-By` or any attribution trailer** (user rule). Do not change any package version.
- After code changes run `graphify update .` (project rule) before the final commit of each task.
- Production needs `yarn db:setup:prod` after deploy (new column + backfill SQL) — note it in the PR, do not run it.

## Review Focus

1. **Subtask created into a done column, then parent moved** — subtask keeps its `subtaskPosition`; toggling done/undone on any subtask never changes list order. (Test in Task 1.)
2. **Converting a subtask whose old parent is then reordered** — promote clears `subtaskPosition` and gives a fresh column-end `position`, so a promoted task never ties with a board key; demote appends after last sibling. (Tests in Task 3.)
3. **Paste of whitespace-only / CRLF / >50 lines** — CRLF splits like LF, blank lines dropped, one remaining line is a normal single add, >50 rejects without creating any. (Unit test in Task 6, server test in Task 2.)
4. **Archived subtasks** — excluded from detail list, siblings, board/list subtasks and from reorder neighbour validation (an archived neighbour id → `'That move is not valid.'`). (Tests in Tasks 1, 2, 4.)
5. **Clicks inside the board checklist** — never open the parent card nor start a drag; Enter/Space on the toggle works by keyboard. (e2e in Task 10.)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/task.ts` (modify) | `subtaskPosition` column + index |
| `src/db/sql/subtask-position-backfill.sql` (create) | idempotent backfill |
| `src/server/tasks/subtasks.ts` (create) | `createSubtasks`, `reorderSubtask`, `setTaskParent`, sibling-key helpers |
| `src/server/tasks/service.ts` (modify) | `createTask` sets `subtaskPosition`, requires top-level parent |
| `src/server/tasks/queries.ts` (modify) | ordering, `siblings`, `withSubtasks`, `listParentCandidates` |
| `src/server/tasks/actions.ts` (modify) | 4 new actions |
| `src/server/activity/service.ts`, `src/lib/activity-text.ts`, `src/lib/notifications.ts` (modify) | `parent` kind |
| `src/lib/subtasks.ts` (create) | pure helpers: paste split, step target, progress |
| `src/components/task/AssigneePicker.tsx` (modify) | `compact` trigger |
| `src/components/task/SubtaskRow.tsx` (create) | one rich sortable row |
| `src/components/task/SubtaskSection.tsx` (rewrite) | header, progress, sortable list, add row |
| `src/components/task/SubtaskBanner.tsx` (create) | "Subtask of" + prev/next |
| `src/components/task/ParentPickerDialog.tsx` (create) | "Make subtask of…" picker |
| `src/components/task/use-set-parent.ts` (create) | convert + Undo toast hook |
| `src/components/task/TaskDetailView.tsx` (modify) | wire banner, menu items, section props |
| `src/lib/shortcuts/registry.ts` (modify) | 3 shortcuts |
| `src/components/kibo-ui/kanban/index.tsx` (modify) | `footer` slot |
| `src/components/board/CardSubtasks.tsx` (create) | board toggle + checklist |
| `src/components/board/TaskCard.tsx`, `BoardColumn.tsx`, `Board.tsx` (modify) | wire footer |
| `src/components/task/TaskTable.tsx` (modify) | chevrons, child rows, expand all |
| `src/components/task/TaskTableSettings.tsx` (modify) | Expand all / Collapse all |
| `src/components/task/TaskRowActions.tsx` (modify) | Make subtask of… / Promote |
| pages `projects/[projectId]/page.tsx`, `list/page.tsx` (modify) | `withSubtasks: true` |
| `tests/server/subtasks.test.ts` (create) | service + query tests |
| `tests/unit/subtasks.test.ts` (create) | pure helper tests |
| `tests/e2e/subtasks.spec.ts` (create), `task-detail.spec.ts`, `board.spec.ts` (modify) | e2e |

---

### Task 1: `subtaskPosition` column, backfill, ordered reads

**Files:**
- Modify: `src/db/schema/task.ts:55-72`
- Create: `src/db/sql/subtask-position-backfill.sql`
- Create: `src/server/tasks/subtasks.ts`
- Modify: `src/server/tasks/service.ts:136-196` (createTask)
- Modify: `src/server/tasks/queries.ts:221-275` (TaskDetail, getTaskDetail)
- Test: `tests/server/subtasks.test.ts`

**Interfaces:**
- Produces: column `task.subtaskPosition: string | null`.
- Produces (in `src/server/tasks/subtasks.ts`): `lockParent(tx: Tx, parentId: string): Promise<boolean>`, `lastSubtaskPosition(tx: Tx, parentId: string): Promise<string | null>`, `type Tx`.
- Produces: `TaskDetail.siblings: { id: string; title: string }[]` (empty for a top-level task; includes the task itself, in order).

- [ ] **Step 1: Write the failing tests**

Create `tests/server/subtasks.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { createTask, updateTask } from '@/server/tasks/service';
import { getTaskDetail } from '@/server/tasks/queries';
import { task } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, created.data.id);
  return { ctx, projectId: created.data.id, statuses: detail!.statuses };
}

async function make(ctx: WorkspaceContext, projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const r = await createTask(ctx, { projectId, title, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe('subtask order', () => {
  it('appends each new subtask after its last sibling', async () => {
    const { ctx, projectId } = await setup('o1@example.com', 'o1');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    await make(ctx, projectId, 'C', { parentTaskId: parent });

    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['A', 'B', 'C']);
    const rows = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.parentTaskId, parent));
    expect(rows.every((r) => r.p !== null)).toBe(true);
  });

  it('leaves top-level tasks without a subtask position', async () => {
    const { ctx, projectId } = await setup('o2@example.com', 'o2');
    const id = await make(ctx, projectId, 'Top');
    const [row] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, id));
    expect(row.p).toBeNull();
  });

  it('keeps a subtask in place when its status changes', async () => {
    const { ctx, projectId, statuses } = await setup('o3@example.com', 'o3');
    const parent = await make(ctx, projectId, 'Parent');
    const a = await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    const done = statuses.find((s) => s.isDone)!;

    expect((await updateTask(ctx, { taskId: a, statusId: done.id })).ok).toBe(true);
    expect((await updateTask(ctx, { taskId: a, statusId: statuses[0].id })).ok).toBe(true);

    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('gives concurrent subtask creates distinct positions', async () => {
    const { ctx, projectId } = await setup('o4@example.com', 'o4');
    const parent = await make(ctx, projectId, 'Parent');
    await Promise.all(Array.from({ length: 6 }, (_, i) => make(ctx, projectId, `S${i}`, { parentTaskId: parent })));
    const rows = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.parentTaskId, parent));
    expect(new Set(rows.map((r) => r.p)).size).toBe(6);
  });

  it('backfill copies board keys into subtask order, keeping the displayed order', async () => {
    const { ctx, projectId } = await setup('o6@example.com', 'o6');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    await db.update(task).set({ subtaskPosition: null }).where(eq(task.parentTaskId, parent));

    const file = readFileSync(join(__dirname, '../../src/db/sql/subtask-position-backfill.sql'), 'utf8');
    await db.execute(sql.raw(file));
    await db.execute(sql.raw(file)); // safe to rerun

    expect((await getTaskDetail(ctx, parent))!.subtasks.map((s) => s.title)).toEqual(['A', 'B']);
    const [top] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, parent));
    expect(top.p).toBeNull();
  });

  it('refuses a subtask as a parent', async () => {
    const { ctx, projectId } = await setup('o5@example.com', 'o5');
    const parent = await make(ctx, projectId, 'Parent');
    const child = await make(ctx, projectId, 'Child', { parentTaskId: parent });
    const r = await createTask(ctx, { projectId, title: 'Grandchild', parentTaskId: child });
    expect(r).toEqual({ ok: false, error: 'Parent task not found.' });
  });
});

describe('getTaskDetail siblings', () => {
  it('lists siblings in subtask order, including the task itself, skipping archived ones', async () => {
    const { ctx, projectId } = await setup('s1@example.com', 's1');
    const parent = await make(ctx, projectId, 'Parent');
    const a = await make(ctx, projectId, 'A', { parentTaskId: parent });
    const b = await make(ctx, projectId, 'B', { parentTaskId: parent });
    const c = await make(ctx, projectId, 'C', { parentTaskId: parent });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, c));

    const detail = await getTaskDetail(ctx, b);
    expect(detail!.siblings).toEqual([{ id: a, title: 'A' }, { id: b, title: 'B' }]);
    expect((await getTaskDetail(ctx, parent))!.siblings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn db:up && yarn db:setup:test && yarn vitest run tests/server/subtasks.test.ts`
Expected: FAIL — `task.subtaskPosition` is undefined (TS/runtime error), `siblings` missing.

- [ ] **Step 3: Add the column and index**

In `src/db/schema/task.ts`, after the `parentTaskId` line:

```ts
    parentTaskId: text('parent_task_id').references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    // Order inside the parent, independent of the board column key above: a
    // subtask changing status must not move in its parent's list. Null on
    // top-level tasks.
    subtaskPosition: text('subtask_position'),
```

and in the index list, replace `index('task_parent_idx').on(t.parentTaskId),` with:

```ts
    index('task_parent_idx').on(t.parentTaskId, t.subtaskPosition),
```

- [ ] **Step 4: Add the backfill SQL**

Create `src/db/sql/subtask-position-backfill.sql`:

```sql
-- Subtasks created before subtask_position existed take their board key as
-- their order. position values are valid fractional keys, and position then id
-- is the order the detail view showed them in, so nothing visibly moves. Keys
-- may tie across columns; reorders renumber on a tie. Safe to rerun.
UPDATE task
SET subtask_position = position
WHERE parent_task_id IS NOT NULL
  AND subtask_position IS NULL;
```

- [ ] **Step 5: Add sibling-key helpers**

Create `src/server/tasks/subtasks.ts`:

```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, task } from '@/db';
import { byKey } from '@/lib/position';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks a parent for the rest of the transaction, so writes that place its
 * subtasks run one at a time and each reads the keys the previous one left (as
 * lockColumns does for board columns). NO KEY UPDATE does not block the
 * key-share lock that inserting a child referencing it takes. False when the
 * parent is gone.
 */
export async function lockParent(tx: Tx, parentId: string): Promise<boolean> {
  const rows = await tx.select({ id: task.id }).from(task).where(eq(task.id, parentId)).for('no key update');
  return rows.length > 0;
}

/** The parent's last subtask key, or null when it has none. Read after lockParent. */
export async function lastSubtaskPosition(tx: Tx, parentId: string): Promise<string | null> {
  const [last] = await tx
    .select({ p: task.subtaskPosition })
    .from(task)
    .where(and(eq(task.parentTaskId, parentId), isNull(task.archivedAt)))
    .orderBy(desc(byKey(task.subtaskPosition)))
    .limit(1);
  return last?.p ?? null;
}
```

- [ ] **Step 6: Make `createTask` set the key and require a top-level parent**

In `src/server/tasks/service.ts`:

Add import: `import { lastSubtaskPosition, lockParent } from '@/server/tasks/subtasks';`

In the parent check `where(and(...))`, add `isNull(task.parentTaskId),` after `eq(task.workspaceId, ctx.workspaceId),` and update the comment above to:

```ts
    // A subtask lives on its parent's board, so the parent must be in the same
    // project — which also keeps it inside this workspace — and top-level:
    // subtasks are one level deep.
```

Inside the transaction, after `const last = await lastTaskPosition(...)`:

```ts
      let subtaskPosition: string | null = null;
      if (parentTaskId) {
        if (!(await lockParent(tx, parentTaskId))) return err('Parent task not found.');
        subtaskPosition = positionBetween(await lastSubtaskPosition(tx, parentTaskId), null);
      }
```

and add `subtaskPosition,` to the `.values({...})` object after `parentTaskId,`.

- [ ] **Step 7: Order detail subtasks and add siblings**

In `src/server/tasks/queries.ts`:

Change the `TaskDetail` type:

```ts
export type TaskDetail = TaskRow & {
  projectId: string;
  parentId: string | null;
  parentTitle: string | null;
  subtasks: TaskRow[];
  /** The parent's subtasks in order, this one included; empty for a top-level task. */
  siblings: { id: string; title: string }[];
};
```

In `getTaskDetail`, change the subtask query's `.orderBy(byKey(task.position), byId(task.id))` to `.orderBy(byKey(task.subtaskPosition), byId(task.id))`, then before `return`:

```ts
  const parentId = rows[0].parentId;
  const siblings = parentId
    ? await db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(and(eq(task.parentTaskId, parentId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
        .orderBy(byKey(task.subtaskPosition), byId(task.id))
    : [];
```

and add `siblings,` to the returned object.

- [ ] **Step 8: Push schema to test DB and run tests**

Run: `yarn db:setup:test && yarn vitest run tests/server/subtasks.test.ts tests/server/tasks.test.ts`
Expected: PASS (all). If `tests/server/tasks.test.ts` has a test creating a grandchild, it would now fail — none does today.

- [ ] **Step 9: Typecheck, update graph, commit**

```bash
yarn typecheck
graphify update .
git add src/db/schema/task.ts src/db/sql/subtask-position-backfill.sql src/server/tasks/subtasks.ts src/server/tasks/service.ts src/server/tasks/queries.ts tests/server/subtasks.test.ts graphify-out
git commit -m "feat(subtasks): order subtasks by their own key inside the parent"
```

---

### Task 2: Batch create and reorder

**Files:**
- Modify: `src/server/tasks/subtasks.ts`
- Modify: `src/server/tasks/actions.ts`
- Test: `tests/server/subtasks.test.ts`

**Interfaces:**
- Consumes: `lockParent`, `lastSubtaskPosition`, `Tx` (Task 1).
- Produces: `createSubtasks(ctx, { parentTaskId: string; titles: string[] }): Promise<Result<{ ids: string[] }>>`.
- Produces: `reorderSubtask(ctx, { taskId: string; beforeId: string | null; afterId: string | null }): Promise<Result<{ subtaskPosition: string }>>`.
- Produces: `MAX_SUBTASK_BATCH = 50` exported from `src/lib/subtasks.ts` (create the file now with only this constant; Task 6 adds helpers).
- Produces actions: `createSubtasksAction(workspaceSlug, input)`, `reorderSubtaskAction(workspaceSlug, input)` with the same return types.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/subtasks.test.ts` (extend the service import with `createSubtasks, reorderSubtask` from `@/server/tasks/subtasks`):

```ts
describe('createSubtasks', () => {
  it('creates every title in order after existing subtasks', async () => {
    const { ctx, projectId } = await setup('c1@example.com', 'c1');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'First', { parentTaskId: parent });

    const r = await createSubtasks(ctx, { parentTaskId: parent, titles: ['  Two ', '', 'Three'] });

    expect(r.ok && r.data.ids).toHaveLength(2);
    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['First', 'Two', 'Three']);
  });

  it('puts new subtasks in the parent’s column', async () => {
    const { ctx, projectId, statuses } = await setup('c2@example.com', 'c2');
    const parent = await make(ctx, projectId, 'Parent', { statusId: statuses[1].id });
    await createSubtasks(ctx, { parentTaskId: parent, titles: ['A'] });
    expect((await getTaskDetail(ctx, parent))!.subtasks[0].statusId).toBe(statuses[1].id);
  });

  it('rejects more than 50 titles and creates none', async () => {
    const { ctx, projectId } = await setup('c3@example.com', 'c3');
    const parent = await make(ctx, projectId, 'Parent');
    const r = await createSubtasks(ctx, { parentTaskId: parent, titles: Array.from({ length: 51 }, (_, i) => `T${i}`) });
    expect(r).toEqual({ ok: false, error: 'Up to 50 at a time.' });
    expect((await getTaskDetail(ctx, parent))!.subtasks).toHaveLength(0);
  });

  it('rejects an all-blank batch', async () => {
    const { ctx, projectId } = await setup('c4@example.com', 'c4');
    const parent = await make(ctx, projectId, 'Parent');
    expect((await createSubtasks(ctx, { parentTaskId: parent, titles: [' ', ''] })).ok).toBe(false);
  });

  it('refuses a subtask or foreign task as the parent', async () => {
    const a = await setup('c5@example.com', 'c5');
    const b = await setup('c6@example.com', 'c6');
    const parent = await make(a.ctx, a.projectId, 'Parent');
    const child = await make(a.ctx, a.projectId, 'Child', { parentTaskId: parent });
    expect((await createSubtasks(a.ctx, { parentTaskId: child, titles: ['X'] })).ok).toBe(false);
    expect((await createSubtasks(b.ctx, { parentTaskId: parent, titles: ['X'] })).ok).toBe(false);
  });
});

describe('reorderSubtask', () => {
  async function three(email: string, slug: string) {
    const s = await setup(email, slug);
    const parent = await make(s.ctx, s.projectId, 'Parent');
    const a = await make(s.ctx, s.projectId, 'A', { parentTaskId: parent });
    const b = await make(s.ctx, s.projectId, 'B', { parentTaskId: parent });
    const c = await make(s.ctx, s.projectId, 'C', { parentTaskId: parent });
    const order = async () => (await getTaskDetail(s.ctx, parent))!.subtasks.map((t) => t.title);
    return { ...s, parent, a, b, c, order };
  }

  it('moves a subtask between two siblings', async () => {
    const t = await three('r1@example.com', 'r1');
    expect((await reorderSubtask(t.ctx, { taskId: t.c, beforeId: t.a, afterId: t.b })).ok).toBe(true);
    expect(await t.order()).toEqual(['A', 'C', 'B']);
  });

  it('moves to either edge', async () => {
    const t = await three('r2@example.com', 'r2');
    await reorderSubtask(t.ctx, { taskId: t.c, beforeId: null, afterId: t.a });
    expect(await t.order()).toEqual(['C', 'A', 'B']);
    await reorderSubtask(t.ctx, { taskId: t.c, beforeId: t.b, afterId: null });
    expect(await t.order()).toEqual(['A', 'B', 'C']);
  });

  it('refuses reversed neighbours as stale', async () => {
    const t = await three('r3@example.com', 'r3');
    const r = await reorderSubtask(t.ctx, { taskId: t.a, beforeId: t.c, afterId: t.b });
    expect(r).toEqual({ ok: false, error: 'The list changed while you were dragging. Try again.' });
  });

  it('refuses a neighbour from another parent, or an archived one', async () => {
    const t = await three('r4@example.com', 'r4');
    const other = await make(t.ctx, t.projectId, 'Other');
    const stranger = await make(t.ctx, t.projectId, 'Stranger', { parentTaskId: other });
    expect(await reorderSubtask(t.ctx, { taskId: t.a, beforeId: stranger, afterId: null }))
      .toEqual({ ok: false, error: 'That move is not valid.' });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, t.b));
    expect(await reorderSubtask(t.ctx, { taskId: t.a, beforeId: t.b, afterId: null }))
      .toEqual({ ok: false, error: 'That move is not valid.' });
  });

  it('refuses a top-level task', async () => {
    const t = await three('r5@example.com', 'r5');
    expect((await reorderSubtask(t.ctx, { taskId: t.parent, beforeId: null, afterId: null })).ok).toBe(false);
  });

  it('places between two siblings that share a key by renumbering', async () => {
    const t = await three('r6@example.com', 'r6');
    // Backfilled subtasks can tie: copy A's key onto B.
    const [rowA] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, t.a));
    await db.update(task).set({ subtaskPosition: rowA.p }).where(eq(task.id, t.b));
    const [lo, hi] = [t.a, t.b].sort(); // ties read in id (codepoint) order
    const r = await reorderSubtask(t.ctx, { taskId: t.c, beforeId: lo, afterId: hi });
    expect(r.ok).toBe(true);
    const titles = await t.order();
    expect(titles.indexOf('C')).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/subtasks.test.ts`
Expected: FAIL — `createSubtasks` / `reorderSubtask` not exported.

- [ ] **Step 3: Implement**

Create `src/lib/subtasks.ts`:

```ts
/** The most subtasks one paste or batch call may create. */
export const MAX_SUBTASK_BATCH = 50;
```

Append to `src/server/tasks/subtasks.ts` (merge imports at the top: `and, desc, eq, gt, isNull, ne` from drizzle-orm; `z` from zod; `db, task, taskStatus` from `@/db`; `newId` from `@/lib/ids`; `byId, byKey, positionBetween, positionsAfter, positionsForCount` from `@/lib/position`; `err, ok, withAction, type Result` from `@/lib/result`; `type WorkspaceContext` from `@/lib/session`; `MAX_SUBTASK_BATCH` from `@/lib/subtasks`; `recordActivity` from `@/server/activity/service`; `emitChange` from `@/server/changes/service`; `lastTaskPosition, lockColumns` from `@/server/tasks/columns`):

```ts
const STALE_REORDER = 'The list changed while you were dragging. Try again.';
const INVALID_MOVE = 'That move is not valid.';

/** A top-level, unarchived task of this workspace in an active project, or null. */
async function loadParent(ctx: WorkspaceContext, parentId: string) {
  const [row] = await db
    .select({ id: task.id, projectId: task.projectId, statusId: task.statusId, title: task.title, isDone: taskStatus.isDone })
    .from(task)
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
    .where(and(
      eq(task.id, parentId), eq(task.workspaceId, ctx.workspaceId),
      isNull(task.parentTaskId), isNull(task.archivedAt),
    ))
    .limit(1);
  return row ?? null;
}

const createSubtasksSchema = z.object({
  parentTaskId: z.string().min(1),
  titles: z.array(z.string()),
});

export type CreateSubtasksInput = z.input<typeof createSubtasksSchema>;

/**
 * Several subtasks at once, from a multi-line paste. All or nothing, appended
 * after the last sibling in the order given, each in the parent's column (as
 * a single add puts it).
 */
export async function createSubtasks(
  ctx: WorkspaceContext,
  input: CreateSubtasksInput,
): Promise<Result<{ ids: string[] }>> {
  return withAction(async () => {
    const parsed = createSubtasksSchema.safeParse(input);
    if (!parsed.success) return err('Those subtasks are not valid.');
    const titles = parsed.data.titles.map((t) => t.trim()).filter((t) => t.length > 0);
    if (titles.length === 0) return err('Give the subtask a title.');
    if (titles.length > MAX_SUBTASK_BATCH) return err('Up to 50 at a time.');
    if (titles.some((t) => t.length > 200)) return err('Title is too long.');

    const parent = await loadParent(ctx, parsed.data.parentTaskId);
    if (!parent) return err('Parent task not found.');

    return db.transaction(async (tx) => {
      if (!(await lockColumns(tx, [parent.statusId]))) return err('That column no longer exists.');
      if (!(await lockParent(tx, parent.id))) return err('Parent task not found.');
      const boardKeys = positionsAfter(await lastTaskPosition(tx, parent.projectId, parent.statusId), titles.length);
      const subKeys = positionsAfter(await lastSubtaskPosition(tx, parent.id), titles.length);
      const ids = titles.map(() => newId());
      const now = new Date();

      await tx.insert(task).values(titles.map((title, i) => ({
        id: ids[i],
        workspaceId: ctx.workspaceId,
        projectId: parent.projectId,
        title,
        statusId: parent.statusId,
        parentTaskId: parent.id,
        position: boardKeys[i],
        subtaskPosition: subKeys[i],
        createdBy: ctx.userId,
        completedAt: parent.isDone ? now : null,
      })));
      for (let i = 0; i < ids.length; i++) {
        await recordActivity(ctx, { taskId: ids[i], kind: 'created', to: titles[i] }, tx);
      }
      await emitChange(ctx, { projectId: parent.projectId }, tx);
      return ok({ ids });
    });
  });
}

const reorderSchema = z.object({
  taskId: z.string().min(1),
  beforeId: z.string().nullable(),
  afterId: z.string().nullable(),
});

export type ReorderSubtaskInput = z.input<typeof reorderSchema>;

/**
 * A subtask drag. As with moveTask, the client sends neighbours and the server
 * computes the key under the parent's lock, so two concurrent drags cannot
 * land on the same key.
 */
export async function reorderSubtask(
  ctx: WorkspaceContext,
  input: ReorderSubtaskInput,
): Promise<Result<{ subtaskPosition: string }>> {
  return withAction(async () => {
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return err(INVALID_MOVE);
    const { taskId, beforeId, afterId } = parsed.data;

    const [owned] = await db
      .select({ id: task.id, parentId: task.parentTaskId, projectId: task.projectId })
      .from(task)
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
      .limit(1);
    if (!owned) return err('Task not found.');
    if (!owned.parentId) return err('Only subtasks can be reordered here.');
    const parentId = owned.parentId;

    return db.transaction(async (tx) => {
      if (!(await lockParent(tx, parentId))) return err('Parent task not found.');

      // null = list edge; undefined = not a valid neighbour (self, archived, another parent).
      const neighbour = async (id: string | null): Promise<string | null | undefined> => {
        if (id === null) return null;
        if (id === taskId) return undefined;
        const [row] = await tx
          .select({ p: task.subtaskPosition })
          .from(task)
          .where(and(eq(task.id, id), eq(task.parentTaskId, parentId), isNull(task.archivedAt)))
          .limit(1);
        return row ? row.p : undefined;
      };

      const before = await neighbour(beforeId);
      const after = await neighbour(afterId);
      if (before === undefined || after === undefined) return err(INVALID_MOVE);
      if (before !== null && after !== null) {
        if (before > after) return err(STALE_REORDER);
        if (before === after && beforeId! > afterId!) return err(STALE_REORDER);
      }

      let key: string;
      if (before !== null && before === after) {
        // Tied keys (left by the backfill): renumber the siblings in displayed
        // order, then place between the new keys.
        const siblings = await tx
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.parentTaskId, parentId), isNull(task.archivedAt), ne(task.id, taskId)))
          .orderBy(byKey(task.subtaskPosition), byId(task.id));
        const keys = positionsForCount(siblings.length);
        const renumbered = new Map(siblings.map((s, i) => [s.id, keys[i]]));
        for (const [id, k] of renumbered) {
          await tx.update(task).set({ subtaskPosition: k }).where(eq(task.id, id));
        }
        key = positionBetween(renumbered.get(beforeId!)!, renumbered.get(afterId!)!);
      } else {
        // Against the sibling right after `before` now, not the one the client
        // saw: a concurrent drop into the same gap may have landed since.
        const [next] = await tx
          .select({ p: task.subtaskPosition })
          .from(task)
          .where(and(
            eq(task.parentTaskId, parentId), isNull(task.archivedAt), ne(task.id, taskId),
            before === null ? undefined : gt(byKey(task.subtaskPosition), before),
          ))
          .orderBy(byKey(task.subtaskPosition))
          .limit(1);
        // Dropped at the end: nothing after it, whatever sorts after `before`.
        key = positionBetween(before, afterId === null ? null : next?.p ?? null);
      }

      await tx.update(task).set({ subtaskPosition: key, updatedAt: new Date() }).where(eq(task.id, taskId));
      // A reorder is not history, as for board drags.
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ subtaskPosition: key });
    });
  });
}
```

(Also import `project` from `@/db`.) With both neighbours `null` (the only subtask) this yields `positionBetween(null, null)`, a valid key.

Add to `src/server/tasks/actions.ts` (import `createSubtasks, reorderSubtask, type CreateSubtasksInput, type ReorderSubtaskInput` from `./subtasks`):

```ts
export async function createSubtasksAction(
  workspaceSlug: string,
  input: CreateSubtasksInput,
): Promise<Result<{ ids: string[] }>> {
  return withAction(async () => {
    const result = await createSubtasks(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function reorderSubtaskAction(
  workspaceSlug: string,
  input: ReorderSubtaskInput,
): Promise<Result<{ subtaskPosition: string }>> {
  return withAction(async () => {
    const result = await reorderSubtask(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/server/subtasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, graph, commit**

```bash
yarn typecheck && yarn lint
graphify update .
git add src/lib/subtasks.ts src/server/tasks/subtasks.ts src/server/tasks/actions.ts tests/server/subtasks.test.ts graphify-out
git commit -m "feat(subtasks): batch create and drag reorder on the server"
```

---

### Task 3: Convert task ↔ subtask (server) and the `parent` activity kind

**Files:**
- Modify: `src/server/tasks/subtasks.ts`
- Modify: `src/server/tasks/queries.ts` (add `listParentCandidates`)
- Modify: `src/server/tasks/actions.ts`
- Modify: `src/server/activity/service.ts:5-8`
- Modify: `src/lib/activity-text.ts`
- Modify: `src/lib/notifications.ts:10-13,67-70`
- Test: `tests/server/subtasks.test.ts`, `tests/unit/activity-text.test.ts`

**Interfaces:**
- Produces: `setTaskParent(ctx, { taskId: string; parentTaskId: string | null }): Promise<Result<{ previousParentId: string | null }>>`.
- Produces: `listParentCandidates(ctx, taskId: string, term: string): Promise<{ id: string; title: string }[]>`.
- Produces actions: `setTaskParentAction(workspaceSlug, input)`, `parentCandidatesAction(workspaceSlug, taskId, term): Promise<Result<{ id: string; title: string }[]>>`.
- Produces: activity kind `'parent'` (from = old parent title or null, to = new parent title or null); change kind `'parent'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/subtasks.test.ts` (import `setTaskParent` from `@/server/tasks/subtasks`, `listParentCandidates, listProjectTasks` from `@/server/tasks/queries`, `taskActivity` from `@/db`):

```ts
describe('setTaskParent', () => {
  it('makes a task a subtask at the end of its new siblings, keeping its status', async () => {
    const { ctx, projectId, statuses } = await setup('p1@example.com', 'p1');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'Existing', { parentTaskId: parent });
    const loose = await make(ctx, projectId, 'Loose', { statusId: statuses[1].id });

    const r = await setTaskParent(ctx, { taskId: loose, parentTaskId: parent });

    expect(r).toEqual({ ok: true, data: { previousParentId: null } });
    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['Existing', 'Loose']);
    expect(detail!.subtasks[1].statusId).toBe(statuses[1].id);
    expect((await listProjectTasks(ctx, projectId)).map((t) => t.title)).toEqual(['Parent']);
    const [act] = await db.select().from(taskActivity).where(and(eq(taskActivity.taskId, loose), eq(taskActivity.kind, 'parent')));
    expect(act.toValue).toBe('Parent');
  });

  it('promotes a subtask to the end of its column and clears its subtask key', async () => {
    const { ctx, projectId } = await setup('p2@example.com', 'p2');
    const parent = await make(ctx, projectId, 'Parent');
    const child = await make(ctx, projectId, 'Child', { parentTaskId: parent });
    await make(ctx, projectId, 'Later');

    const r = await setTaskParent(ctx, { taskId: child, parentTaskId: null });

    expect(r).toEqual({ ok: true, data: { previousParentId: parent } });
    const top = await listProjectTasks(ctx, projectId);
    expect(top.map((t) => t.title)).toEqual(['Parent', 'Later', 'Child']);
    expect(new Set(top.map((t) => t.position)).size).toBe(3);
    const [row] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, child));
    expect(row.p).toBeNull();
  });

  it('refuses self, a subtask parent, another project, an archived parent, and a task with subtasks', async () => {
    const { ctx, projectId } = await setup('p3@example.com', 'p3');
    const other = await createProject(ctx, { name: 'Other' });
    if (!other.ok) throw new Error('setup');
    const a = await make(ctx, projectId, 'A');
    const b = await make(ctx, projectId, 'B');
    const bChild = await make(ctx, projectId, 'B child', { parentTaskId: b });
    const elsewhere = await make(ctx, other.data.id, 'Elsewhere');
    const archived = await make(ctx, projectId, 'Archived');
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, archived));

    expect((await setTaskParent(ctx, { taskId: a, parentTaskId: a })).ok).toBe(false);
    expect((await setTaskParent(ctx, { taskId: a, parentTaskId: bChild })).ok).toBe(false);
    expect((await setTaskParent(ctx, { taskId: a, parentTaskId: elsewhere })).ok).toBe(false);
    expect((await setTaskParent(ctx, { taskId: a, parentTaskId: archived })).ok).toBe(false);
    expect(await setTaskParent(ctx, { taskId: b, parentTaskId: a }))
      .toEqual({ ok: false, error: 'Tasks with subtasks can’t become subtasks.' });
  });

  it('refuses another workspace’s task', async () => {
    const a = await setup('p4@example.com', 'p4');
    const b = await setup('p5@example.com', 'p5');
    const mine = await make(a.ctx, a.projectId, 'Mine');
    const theirs = await make(b.ctx, b.projectId, 'Theirs');
    expect((await setTaskParent(a.ctx, { taskId: theirs, parentTaskId: mine })).ok).toBe(false);
  });

  it('is a no-op when the parent is unchanged', async () => {
    const { ctx, projectId } = await setup('p6@example.com', 'p6');
    const parent = await make(ctx, projectId, 'Parent');
    const child = await make(ctx, projectId, 'Child', { parentTaskId: parent });
    expect(await setTaskParent(ctx, { taskId: child, parentTaskId: parent }))
      .toEqual({ ok: true, data: { previousParentId: parent } });
    const acts = await db.select().from(taskActivity).where(eq(taskActivity.kind, 'parent'));
    expect(acts).toHaveLength(0);
  });
});

describe('listParentCandidates', () => {
  it('offers top-level tasks of the same project matching the term, never self', async () => {
    const { ctx, projectId } = await setup('pc1@example.com', 'pc1');
    const other = await createProject(ctx, { name: 'Other' });
    if (!other.ok) throw new Error('setup');
    const me = await make(ctx, projectId, 'Design me');
    const design = await make(ctx, projectId, 'Design hero');
    await make(ctx, projectId, 'Design sub', { parentTaskId: design });
    await make(ctx, other.data.id, 'Design elsewhere');
    await make(ctx, projectId, 'Unrelated');

    const hits = await listParentCandidates(ctx, me, 'design');
    expect(hits).toEqual([{ id: design, title: 'Design hero' }]);
    expect((await listParentCandidates(ctx, me, '')).map((h) => h.title)).toEqual(['Design hero', 'Unrelated']);
  });
});
```

(Add `and` to the drizzle import.)

Append to `tests/unit/activity-text.test.ts` (follow the file's existing entry-builder; if it builds entries inline, use the same shape):

```ts
  it('describes a parent change', () => {
    expect(describeActivity({ ...base, kind: 'parent', from: null, to: 'Launch' })).toBe('made it a subtask of “Launch”');
    expect(describeActivity({ ...base, kind: 'parent', from: 'Launch', to: null })).toBe('promoted it to a task');
    expect(describeActivity({ ...base, kind: 'parent', from: 'Old', to: 'New' })).toBe('made it a subtask of “New”');
  });
```

(`base` = whatever minimal activity entry object the existing tests in that file use; read the file first and reuse it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/subtasks.test.ts tests/unit/activity-text.test.ts`
Expected: FAIL — `setTaskParent`, `listParentCandidates` missing; `'parent'` not a kind.

- [ ] **Step 3: Add the kind**

`src/server/activity/service.ts`:

```ts
export const ACTIVITY_KINDS = [
  'created', 'title', 'status', 'priority', 'assignee', 'due_date',
  'attachment_added', 'attachment_removed', 'parent',
] as const;
```

`src/lib/activity-text.ts`, add before the closing of the switch:

```ts
    case 'parent':
      return entry.to ? `made it a subtask of “${entry.to}”` : 'promoted it to a task';
```

`src/lib/notifications.ts`:

```ts
export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment', 'reaction', 'parent',
] as const;
```

and in `FIELD_LABELS` add `parent: 'parent task',`.

Run `yarn typecheck` — fix any other exhaustive `Record<TaskChangeKind, …>` / `switch` it reports (e.g. OpenAPI enums, push-message copy) by adding a `parent` entry with copy `'parent task'`.

- [ ] **Step 4: Implement `setTaskParent`**

Append to `src/server/tasks/subtasks.ts` (also import `notifyTaskChange` from `@/server/notifications/changes`):

```ts
const setParentSchema = z.object({
  taskId: z.string().min(1),
  parentTaskId: z.string().min(1).nullable(),
});

export type SetTaskParentInput = z.input<typeof setParentSchema>;

/**
 * Makes a task a subtask of another (parentTaskId set) or promotes a subtask
 * to a top-level task (null). Depth stays one: the new parent must be
 * top-level and the task must have no subtasks of its own.
 */
export async function setTaskParent(
  ctx: WorkspaceContext,
  input: SetTaskParentInput,
): Promise<Result<{ previousParentId: string | null }>> {
  return withAction(async () => {
    const parsed = setParentSchema.safeParse(input);
    if (!parsed.success) return err('That change is not valid.');
    const { taskId, parentTaskId } = parsed.data;

    const parentAlias = alias(task, 'old_parent');
    const [owned] = await db
      .select({
        id: task.id, projectId: task.projectId, statusId: task.statusId,
        parentId: task.parentTaskId, parentTitle: parentAlias.title,
      })
      .from(task)
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .leftJoin(parentAlias, eq(parentAlias.id, task.parentTaskId))
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId), isNull(task.archivedAt)))
      .limit(1);
    if (!owned) return err('Task not found.');
    if (owned.parentId === parentTaskId) return ok({ previousParentId: owned.parentId });

    let newParentTitle: string | null = null;
    if (parentTaskId) {
      if (parentTaskId === taskId) return err('A task can’t be its own subtask.');
      const parent = await loadParent(ctx, parentTaskId);
      if (!parent || parent.projectId !== owned.projectId) return err('Parent task not found.');
      newParentTitle = parent.title;
      const [child] = await db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.parentTaskId, taskId), isNull(task.archivedAt)))
        .limit(1);
      if (child) return err('Tasks with subtasks can’t become subtasks.');
    }

    return db.transaction(async (tx) => {
      if (parentTaskId) {
        if (!(await lockParent(tx, parentTaskId))) return err('Parent task not found.');
        const key = positionBetween(await lastSubtaskPosition(tx, parentTaskId), null);
        await tx.update(task)
          .set({ parentTaskId, subtaskPosition: key, updatedAt: new Date() })
          .where(eq(task.id, taskId));
      } else {
        // A fresh board key at the column's end: the old one was only ever
        // compared with siblings' keys and could tie with a board card's.
        if (!(await lockColumns(tx, [owned.statusId]))) return err('That column no longer exists.');
        const last = await lastTaskPosition(tx, owned.projectId, owned.statusId);
        await tx.update(task)
          .set({ parentTaskId: null, subtaskPosition: null, position: positionBetween(last, null), updatedAt: new Date() })
          .where(eq(task.id, taskId));
      }
      await recordActivity(ctx, { taskId, kind: 'parent', from: owned.parentTitle, to: newParentTitle }, tx);
      await notifyTaskChange(ctx, tx, { taskId, changes: ['parent'] });
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ previousParentId: owned.parentId });
    });
  });
}
```

(Import `alias` from `drizzle-orm/pg-core`.)

- [ ] **Step 5: Implement `listParentCandidates`**

Append to `src/server/tasks/queries.ts`:

```ts
/**
 * What "Make subtask of…" offers: top-level, unarchived tasks in the same
 * project as `taskId`, never the task itself, title matching `term` (all when
 * empty). Board order, capped at 20.
 */
export async function listParentCandidates(
  ctx: WorkspaceContext,
  taskId: string,
  term: string,
): Promise<{ id: string; title: string }[]> {
  const [self] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!self) return [];
  const trimmed = term.trim().slice(0, 100);
  return db
    .select({ id: task.id, title: task.title })
    .from(task)
    .where(and(
      eq(task.projectId, self.projectId),
      eq(task.workspaceId, ctx.workspaceId),
      isNull(task.parentTaskId),
      isNull(task.archivedAt),
      ne(task.id, taskId),
      trimmed ? ilike(task.title, likePattern(trimmed)) : undefined,
    ))
    .orderBy(byKey(task.position), byId(task.id))
    .limit(20);
}
```

Add `ne` to the drizzle import. Check `likePattern` in `./search-query` — it escapes wildcards; confirm it wraps with `%…%` (read it); if it does not, pass `` `%${likePattern(trimmed)}%` ``.

- [ ] **Step 6: Add the actions**

In `src/server/tasks/actions.ts` (import `setTaskParent, type SetTaskParentInput` from `./subtasks`, `listParentCandidates` from `./queries`):

```ts
export async function setTaskParentAction(
  workspaceSlug: string,
  input: SetTaskParentInput,
): Promise<Result<{ previousParentId: string | null }>> {
  return withAction(async () => {
    const result = await setTaskParent(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

/** Read-only: the "Make subtask of…" picker's options. */
export async function parentCandidatesAction(
  workspaceSlug: string,
  taskId: string,
  term: string,
): Promise<Result<{ id: string; title: string }[]>> {
  return withAction(async () => ok(await listParentCandidates(await requireWorkspace(workspaceSlug), taskId, term)));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn vitest run tests/server/subtasks.test.ts tests/unit/activity-text.test.ts tests/unit/notifications.test.ts tests/server/change-notifications.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, graph, commit**

```bash
yarn typecheck && yarn lint
graphify update .
git add -A src/server src/lib tests graphify-out
git commit -m "feat(subtasks): make a task a subtask or promote it back"
```

---

### Task 4: Subtasks on board and list data

**Files:**
- Modify: `src/server/tasks/queries.ts:16-35,86-108`
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx:39`
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/list/page.tsx:39`
- Test: `tests/server/subtasks.test.ts`

**Interfaces:**
- Produces: `TaskRow.subtasks?: TaskRow[]` (present only when asked for).
- Produces: `listProjectTasks(ctx, projectId, filter?, opts?: { withSubtasks?: boolean }): Promise<TaskRow[]>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('listProjectTasks withSubtasks', () => {
  it('attaches unarchived subtasks in order, unfiltered, only when asked', async () => {
    const { ctx, projectId } = await setup('l1@example.com', 'l1');
    const parent = await make(ctx, projectId, 'Parent', { priority: 'high' });
    const a = await make(ctx, projectId, 'A', { parentTaskId: parent });
    const b = await make(ctx, projectId, 'B', { parentTaskId: parent });
    const gone = await make(ctx, projectId, 'Gone', { parentTaskId: parent });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, gone));
    await reorderSubtask(ctx, { taskId: b, beforeId: null, afterId: a });

    const plain = await listProjectTasks(ctx, projectId);
    expect(plain[0].subtasks).toBeUndefined();

    // A filter that only the parent matches still brings its subtasks.
    const rows = await listProjectTasks(ctx, projectId, { priority: ['high'] }, { withSubtasks: true });
    expect(rows.map((r) => r.title)).toEqual(['Parent']);
    expect(rows[0].subtasks!.map((s) => s.title)).toEqual(['B', 'A']);
  });
});
```

(Check `TaskFilter` in `src/lib/task-filter.ts` for the exact priority filter key and adjust the literal if it differs.)

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run tests/server/subtasks.test.ts -t withSubtasks`
Expected: FAIL — fourth argument ignored / `subtasks` undefined.

- [ ] **Step 3: Implement**

In `TaskRow` add, after `subtaskDoneCount: number;`:

```ts
  /** The task's subtasks in order; only on lists that asked for them. */
  subtasks?: TaskRow[];
```

and change `BaseRow` to `Omit<TaskRow, 'labels' | 'subtaskCount' | 'subtaskDoneCount' | 'subtasks'>`.

Replace `listProjectTasks` with:

```ts
/** Top-level tasks of one project, board order; with `withSubtasks`, each carries its subtasks. */
export async function listProjectTasks(
  ctx: WorkspaceContext,
  projectId: string,
  filter: TaskFilter = {},
  opts: { withSubtasks?: boolean } = {},
): Promise<TaskRow[]> {
  const filters = await taskFilterSql(ctx, filter, 'project');
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
        ...filters,
      ),
    )
    .orderBy(byKey(task.position), byId(task.id));

  const tasks = await attachLabels(rows);
  if (!opts.withSubtasks || tasks.length === 0) return tasks;

  // Unfiltered: a parent the filter kept shows all its steps.
  const subRows = await db
    .select({ ...baseColumns, parentId: task.parentTaskId })
    .from(task)
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(and(
      inArray(task.parentTaskId, tasks.map((t) => t.id)),
      eq(task.workspaceId, ctx.workspaceId),
      isNull(task.archivedAt),
    ))
    .orderBy(byKey(task.subtaskPosition), byId(task.id));
  const subs = await attachLabels(subRows.map(({ parentId: _, ...r }) => r));
  const byParent = new Map(tasks.map((t) => [t.id, [] as TaskRow[]]));
  subRows.forEach((r, i) => byParent.get(r.parentId!)?.push(subs[i]));
  return tasks.map((t) => ({ ...t, subtasks: byParent.get(t.id) ?? [] }));
}
```

(`attachLabels` keeps input order, so `subs[i]` lines up with `subRows[i]`.)

Board page `projects/[projectId]/page.tsx:39` and list page `list/page.tsx:39`: change to `listProjectTasks(ctx, projectId, resolved.filter, { withSubtasks: true })`.

- [ ] **Step 4: Run tests**

Run: `yarn vitest run tests/server/subtasks.test.ts tests/server/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, graph, commit**

```bash
yarn typecheck
graphify update .
git add src/server/tasks/queries.ts "src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx" "src/app/(app)/[workspaceSlug]/projects/[projectId]/list/page.tsx" tests/server/subtasks.test.ts graphify-out
git commit -m "feat(subtasks): load subtasks with board and list tasks"
```

---

### Task 5: Compact assignee picker

**Files:**
- Modify: `src/components/task/AssigneePicker.tsx`

**Interfaces:**
- Produces: `AssigneePicker` props gain `compact?: boolean` and `label?: string` (aria-label for the compact trigger). Compact trigger = 28px avatar button; unassigned shows a dashed circle with `IconUser`.

- [ ] **Step 1: Implement**

Add props and swap the trigger when `compact`:

```tsx
export function AssigneePicker({
  id,
  members,
  value,
  onChange,
  compact = false,
  label,
}: {
  id?: string;
  members: MemberRow[];
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Avatar-only trigger, for dense rows. */
  compact?: boolean;
  /** Accessible name of the compact trigger. */
  label?: string;
}) {
```

Replace `<Popover.Trigger id={id} className={triggerRoot()}> … </Popover.Trigger>` with:

```tsx
      {compact ? (
        <Popover.Trigger
          id={id}
          aria-label={label ?? (selected ? `Assignee: ${selected.name}` : 'Assign')}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950"
        >
          {selected ? (
            <AssigneeAvatar name={selected.name} image={selected.image} />
          ) : (
            <span className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-stroke-sub-300">
              <IconUser className="size-3.5" aria-hidden="true" />
            </span>
          )}
        </Popover.Trigger>
      ) : (
        <Popover.Trigger id={id} className={triggerRoot()}>
          {/* existing children unchanged */}
        </Popover.Trigger>
      )}
```

Imports: `IconUser` from `@tabler/icons-react`, `AssigneeAvatar` from `@/components/task/AssigneeAvatar` (check its props: it takes `name` and `image`; `MemberRow` has `name` and `image` — confirm in `src/server/labels/queries.ts`). The popover content's width class uses the trigger width; for compact set `className={cn(compact ? 'w-64' : 'w-[var(--radix-popover-trigger-width)] min-w-64', 'p-0')}` and `align={compact ? 'end' : 'start'}`.

- [ ] **Step 2: Verify existing behaviour unchanged**

Run: `yarn typecheck && yarn lint && yarn vitest run tests/unit`
Expected: PASS (no callers pass `compact` yet).

- [ ] **Step 3: Commit**

```bash
graphify update .
git add src/components/task/AssigneePicker.tsx graphify-out
git commit -m "feat(ui): compact avatar trigger for the assignee picker"
```

---

### Task 6: Pure subtask helpers

**Files:**
- Modify: `src/lib/subtasks.ts`
- Test: `tests/unit/subtasks.test.ts`

**Interfaces:**
- Produces: `splitPastedLines(text: string): string[]` — split on `\r\n|\n|\r`, trim, drop empties, strip a leading list marker (`- `, `* `, `• `, `1. `, `1) `, `[ ] `, `[x] `).
- Produces: `stepTarget(ids: string[], id: string, delta: -1 | 1): { toIndex: number; beforeId: string | null; afterId: string | null } | null` — built on `dropTarget` from `@/lib/todo-list`.
- Produces: `progressPercent(done: number, total: number): number` — 0 when total is 0, rounded.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/subtasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { progressPercent, splitPastedLines, stepTarget } from '@/lib/subtasks';

describe('splitPastedLines', () => {
  it('splits on any newline, trims and drops blanks', () => {
    expect(splitPastedLines(' one \r\ntwo\n\n  \rthree ')).toEqual(['one', 'two', 'three']);
  });
  it('strips list markers and checkboxes', () => {
    expect(splitPastedLines('- a\n* b\n• c\n1. d\n2) e\n[ ] f\n[x] g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
  it('keeps a single line as one item', () => {
    expect(splitPastedLines('just one')).toEqual(['just one']);
  });
  it('returns nothing for whitespace', () => {
    expect(splitPastedLines(' \n\t\n')).toEqual([]);
  });
});

describe('stepTarget', () => {
  const ids = ['a', 'b', 'c'];
  it('moves down one place', () => {
    expect(stepTarget(ids, 'a', 1)).toEqual({ toIndex: 1, beforeId: 'b', afterId: 'c' });
  });
  it('moves up one place', () => {
    expect(stepTarget(ids, 'c', -1)).toEqual({ toIndex: 1, beforeId: 'a', afterId: 'b' });
  });
  it('is null past either end', () => {
    expect(stepTarget(ids, 'a', -1)).toBeNull();
    expect(stepTarget(ids, 'c', 1)).toBeNull();
  });
});

describe('progressPercent', () => {
  it('rounds and handles empty', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(3, 3)).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run tests/unit/subtasks.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

`src/lib/subtasks.ts`:

```ts
import { dropTarget } from '@/lib/todo-list';

/** The most subtasks one paste or batch call may create. */
export const MAX_SUBTASK_BATCH = 50;

const LIST_MARKER = /^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/;

/** A pasted block as subtask titles: one per non-blank line, list markers dropped. */
export function splitPastedLines(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim().replace(LIST_MARKER, '').trim())
    .filter((line) => line.length > 0);
}

/** Move one place up or down: the same neighbour contract as a drag. Null at an end. */
export function stepTarget(ids: string[], id: string, delta: -1 | 1) {
  const from = ids.indexOf(id);
  const over = ids[from + delta];
  if (from === -1 || over === undefined) return null;
  return dropTarget(ids, id, over);
}

export function progressPercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run tests/unit/subtasks.test.ts`
Expected: PASS. (`stepTarget(['a','b','c'],'a',1)`: `arrayMove` → `['b','a','c']`, toIndex 1, before `b`, after `c` — matches.)

- [ ] **Step 5: Commit**

```bash
graphify update .
git add src/lib/subtasks.ts tests/unit/subtasks.test.ts graphify-out
git commit -m "feat(subtasks): paste splitting and one-step move helpers"
```

---

### Task 7: Rich subtask rows and the rebuilt section

**Files:**
- Create: `src/components/task/SubtaskRow.tsx`
- Rewrite: `src/components/task/SubtaskSection.tsx`
- Modify: `src/components/task/TaskDetailView.tsx:484-492`
- Modify: `tests/e2e/task-detail.spec.ts:68-85`, `tests/e2e/board.spec.ts:140-170`

**Interfaces:**
- Consumes: `createTaskAction`, `createSubtasksAction`, `reorderSubtaskAction`, `updateTaskAction`, `deleteTaskAction`, `setTaskParentAction` (Task 3; Promote item), `splitPastedLines`, `stepTarget`, `progressPercent`, `MAX_SUBTASK_BATCH`, `AssigneePicker compact`, `TaskFieldItems`, `dropTarget`.
- Produces: `SubtaskSection` props `{ parent: TaskRow; subtasks: TaskRow[]; statuses: StatusRow[]; members: MemberRow[]; timezone: string; projectId: string; workspaceSlug: string; pageBase?: string }`.
- Produces: `SubtaskRow` props `{ subtask: TaskRow; statuses; members; timezone; workspaceSlug; isFirst: boolean; isLast: boolean; onOpen(): void; onStep(delta: -1 | 1): void; onPromote(): void }`.
- Produces: `useSetParent(workspaceSlug)` hook in `src/components/task/use-set-parent.ts`: `(taskId: string, parentTaskId: string | null, undoParentId: string | null, message: string) => void` — calls `setTaskParentAction`, `router.refresh()`, toasts `message` with an **Undo** action that calls it again with `undoParentId`.

- [ ] **Step 1: Update the e2e tests to the new behaviour (they will fail)**

In `tests/e2e/task-detail.spec.ts`, replace the test `'the subtask input appears on request and Escape puts the button back'` with:

```ts
test('the subtask field is always there, keeps focus, and pastes many lines after a confirm', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'subtask-input');
  const input = dialog.getByPlaceholder('Add subtask…');

  await expect(input).toBeVisible();
  await expect(dialog.getByText('Break this task into steps.')).toBeVisible();
  await input.fill('One');
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Rename “One”' })).toBeVisible();
  await expect(input).toBeFocused();

  await input.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, '- Two\n- Three\n\n- Four');
  await expect(dialog.getByText('Create 3 subtasks?')).toBeVisible();
  await input.press('Enter');
  await expect(dialog.getByText('1/4').or(dialog.getByText('0/4'))).toBeVisible();
  const titles = dialog.getByRole('list', { name: 'Subtasks' }).getByRole('button', { name: /^Rename/ });
  await expect(titles).toHaveText(['One', 'Two', 'Three', 'Four']);
});

test('a subtask renames in place; Escape reverts', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'subtask-rename');
  const input = dialog.getByPlaceholder('Add subtask…');
  await input.fill('Draft');
  await input.press('Enter');

  await dialog.getByRole('button', { name: 'Rename “Draft”' }).click();
  const edit = dialog.getByRole('textbox', { name: 'Subtask title' });
  await edit.fill('Final');
  await edit.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rename “Draft”' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Rename “Draft”' }).click();
  await dialog.getByRole('textbox', { name: 'Subtask title' }).fill('Final');
  await dialog.getByRole('textbox', { name: 'Subtask title' }).press('Enter');
  await expect(dialog.getByRole('button', { name: 'Rename “Final”' })).toBeVisible();
  await page.reload();
  await expect(dialog.getByRole('button', { name: 'Rename “Final”' })).toBeVisible();
});
```

In `tests/e2e/board.spec.ts`, in `'a subtask can be added from the task dialog and opened in place'`, replace the add/open block with:

```ts
  await expect(dialog.getByText('0/0')).toBeVisible();
  await dialog.getByPlaceholder('Add subtask…').fill('Write the copy');
  await dialog.getByPlaceholder('Add subtask…').press('Enter');

  await expect(dialog.getByRole('button', { name: 'Rename “Write the copy”' })).toBeVisible();
  await expect(dialog.getByText('0/1')).toBeVisible();

  // Opening is explicit; the opened subtask names its parent.
  await dialog.getByRole('button', { name: 'Open “Write the copy”' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Write the copy');
  await expect(dialog.getByRole('link', { name: 'Drag me' }).or(dialog.getByRole('button', { name: 'Drag me', exact: true }))).toBeVisible();
  await expect(dialog.getByPlaceholder('Add subtask…')).toBeHidden();

  await dialog.getByRole('button', { name: 'Drag me', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Drag me');
```

(Keep whatever assertions follow in that test; adjust the "Drag me" back-link selector once Task 8 lands — in this task the old chevron button named "Drag me" still exists.)

- [ ] **Step 2: Write `useSetParent`**

Create `src/components/task/use-set-parent.ts`:

```ts
'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { settle } from '@/lib/settle';
import { setTaskParentAction } from '@/server/tasks/actions';

/** Convert a task ↔ subtask, then offer Undo, which converts it straight back. */
export function useSetParent(workspaceSlug: string) {
  const router = useRouter();

  async function run(taskId: string, parentTaskId: string | null): Promise<boolean> {
    const result = await settle(setTaskParentAction(workspaceSlug, { taskId, parentTaskId }));
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return async function setParent(taskId: string, parentTaskId: string | null, undoParentId: string | null, message: string) {
    if (!(await run(taskId, parentTaskId))) return;
    toast.success(message, {
      action: { label: 'Undo', onClick: () => void run(taskId, undoParentId) },
    });
  };
}
```

- [ ] **Step 3: Write `SubtaskRow`**

Create `src/components/task/SubtaskRow.tsx`:

```tsx
'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconArrowBarToUp, IconArrowDown, IconArrowUp, IconArrowUpRight, IconCalendarDue, IconDots, IconGripVertical, IconTrash,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Hint } from '@/components/shell/ShortcutHint';
import { AssigneePicker } from '@/components/task/AssigneePicker';
import { DoneIcon, StrikeText } from '@/components/task/DoneMark';
import { DueChip } from '@/components/task/DueChip';
import { StatusIcon } from '@/components/task/StatusIcon';
import { TaskFieldItems, type TaskPatch } from '@/components/task/TaskFieldItems';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as Dropdown from '@/components/ui/dropdown';
import { LOCAL_ESCAPE_EVENT } from '@/lib/local-escape';
import { settle } from '@/lib/settle';
import { doneToggleTarget } from '@/lib/task-done';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { deleteTaskAction, updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

/** Revealed on hover/focus; always shown where there is no hover (touch). */
const REVEAL = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100';

export function SubtaskRow({
  subtask, statuses, members, timezone, workspaceSlug, isFirst, isLast, onOpen, onStep, onPromote,
}: {
  subtask: TaskRow;
  statuses: StatusRow[];
  members: MemberRow[];
  timezone: string;
  workspaceSlug: string;
  isFirst: boolean;
  isLast: boolean;
  onOpen: () => void;
  onStep: (delta: -1 | 1) => void;
  onPromote: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: subtask.id });

  // Optimistic copies, reverted on a rejected save.
  const [statusId, setStatusId] = useState(subtask.statusId);
  const [assigneeId, setAssigneeId] = useState(subtask.assigneeId);
  const [dueDate, setDueDate] = useState(subtask.dueDate);
  const [title, setTitle] = useState(subtask.title);
  useEffect(() => { setStatusId(subtask.statusId); }, [subtask.statusId]);
  useEffect(() => { setAssigneeId(subtask.assigneeId); }, [subtask.assigneeId]);
  useEffect(() => { setDueDate(subtask.dueDate); }, [subtask.dueDate]);
  useEffect(() => { setTitle(subtask.title); }, [subtask.title]);

  const status = statuses.find((s) => s.id === statusId);
  const done = status?.isDone ?? subtask.completedAt !== null;

  function save(patch: Parameters<typeof updateTaskAction>[1], revert: () => void) {
    startTransition(async () => {
      const result = await settle(updateTaskAction(workspaceSlug, patch));
      if (!result.ok) {
        toast.error(result.error);
        revert();
      }
      router.refresh();
    });
  }

  function setStatus(next: string) {
    const previous = statusId;
    setStatusId(next);
    save({ taskId: subtask.id, statusId: next }, () => setStatusId(previous));
  }

  function toggleDone() {
    const target = doneToggleTarget(statuses, done);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    setStatus(target.id);
  }

  function pickField(patch: TaskPatch) {
    if (patch.statusId) setStatus(patch.statusId);
    if (patch.dueDate !== undefined) {
      const previous = dueDate;
      setDueDate(patch.dueDate);
      save({ taskId: subtask.id, dueDate: patch.dueDate }, () => setDueDate(previous));
    }
  }

  function assign(next: string | null) {
    const previous = assigneeId;
    setAssigneeId(next);
    save({ taskId: subtask.id, assigneeId: next }, () => setAssigneeId(previous));
  }

  // Inline rename.
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function stopEditing(commit: boolean) {
    const next = inputRef.current?.value.trim() ?? '';
    returnFocus.current = true;
    setEditing(false);
    if (!commit || !next || next === subtask.title) return;
    const previous = title;
    setTitle(next);
    save({ taskId: subtask.id, title: next }, () => setTitle(previous));
  }

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    titleButtonRef.current?.focus();
  }, [editing]);

  // Inside the dialog, Escape reaches the dialog first; it hands it over by this event.
  useEffect(() => {
    const form = formRef.current;
    if (!editing || !form) return;
    const cancel = () => stopEditing(false);
    form.addEventListener(LOCAL_ESCAPE_EVENT, cancel);
    return () => form.removeEventListener(LOCAL_ESCAPE_EVENT, cancel);
  });

  async function onDelete() {
    if (!(await confirm({ title: `Delete "${subtask.title}"?`, description: 'This can’t be undone.' }))) return;
    startTransition(async () => {
      const result = await settle(deleteTaskAction(workspaceSlug, { taskId: subtask.id }));
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-subtask-id={subtask.id}
      onKeyDown={(e) => {
        if (!e.altKey || editing) return;
        if (e.key === 'ArrowUp' && !isFirst) { e.preventDefault(); onStep(-1); }
        if (e.key === 'ArrowDown' && !isLast) { e.preventDefault(); onStep(1); }
      }}
      className={cn(
        'group flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-stroke-soft-200 bg-bg-white-0 pr-2 last:border-b-0 lg:flex-nowrap',
        isDragging && 'relative z-10 shadow-regular-md',
      )}
    >
      <Hint label="Drag to reorder (or Alt+↑/↓)">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder “${title}”`}
          className={cn('inline-flex h-11 w-5 shrink-0 cursor-grab items-center justify-center text-text-soft-400 max-lg:hidden', REVEAL)}
        >
          <IconGripVertical className="size-4" aria-hidden="true" />
        </button>
      </Hint>

      <Hint label={done ? 'Mark as not done' : 'Mark as done'}>
        <button
          type="button"
          onClick={toggleDone}
          disabled={pending}
          aria-pressed={done}
          aria-label={done ? `Mark “${title}” as not done` : `Mark “${title}” as done`}
          className="inline-flex size-11 shrink-0 items-center justify-center text-text-soft-400 transition-colors duration-150 hover:text-text-strong-950 disabled:opacity-50 lg:size-9"
        >
          <DoneIcon done={done} className="size-4" />
        </button>
      </Hint>

      {editing ? (
        <form
          ref={formRef}
          data-local-escape=""
          className="min-w-0 flex-1"
          onSubmit={(e) => { e.preventDefault(); stopEditing(true); }}
        >
          <input
            ref={inputRef}
            aria-label="Subtask title"
            defaultValue={title}
            maxLength={200}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => stopEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); stopEditing(false); }
            }}
            className="h-9 w-full rounded-md bg-transparent px-1 text-paragraph-sm text-text-strong-950 ring-1 ring-inset ring-stroke-strong-950"
          />
        </form>
      ) : (
        <button
          ref={titleButtonRef}
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Rename “${title}”`}
          className={cn(
            'min-w-0 flex-1 truncate py-3 text-left text-paragraph-sm transition-colors duration-220 lg:py-2',
            done ? 'text-text-soft-400' : 'text-text-strong-950',
          )}
        >
          <StrikeText done={done}>{title}</StrikeText>
        </button>
      )}

      {/* Fields wrap under the title below lg. */}
      <div className="flex shrink-0 items-center gap-1 max-lg:basis-full max-lg:pb-2 max-lg:pl-11">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={`Status: ${status?.name ?? 'Unknown'}`}
              className="inline-flex h-7 max-w-36 items-center gap-1 rounded-md px-1.5 text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
            >
              {status && <StatusIcon status={status} />}
              <span className="truncate">{status?.name}</span>
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end" className="min-w-44">
            <TaskFieldItems field="status" statuses={statuses} timezone={timezone} onPick={pickField} />
          </Dropdown.Content>
        </Dropdown.Root>

        <AssigneePicker compact members={members} value={assigneeId} onChange={assign} />

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={dueDate ? `Due date: ${dueDate}` : 'Set due date'}
              className={cn(
                'inline-flex h-7 items-center rounded-md px-1 text-text-soft-400 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950',
                !dueDate && REVEAL,
              )}
            >
              {dueDate ? <DueChip dueDate={dueDate} timezone={timezone} done={done} /> : <IconCalendarDue className="size-4" aria-hidden="true" />}
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end">
            <TaskFieldItems field="due" statuses={statuses} timezone={timezone} onPick={pickField} />
          </Dropdown.Content>
        </Dropdown.Root>

        <Hint label="Open subtask">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open “${title}”`}
            className={cn('inline-flex size-7 items-center justify-center rounded-md text-text-soft-400 hover:bg-bg-weak-50 hover:text-text-strong-950', REVEAL)}
          >
            <IconArrowUpRight className="size-4" aria-hidden="true" />
          </button>
        </Hint>

        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              aria-label={`More for “${title}”`}
              className={cn('inline-flex size-7 items-center justify-center rounded-md text-text-soft-400 hover:bg-bg-weak-50 hover:text-text-strong-950', REVEAL)}
            >
              <IconDots className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end" className="w-48">
            <Dropdown.Item onSelect={onOpen}><Dropdown.ItemIcon as={IconArrowUpRight} />Open</Dropdown.Item>
            <Dropdown.Item disabled={isFirst} onSelect={() => onStep(-1)}><Dropdown.ItemIcon as={IconArrowUp} />Move up</Dropdown.Item>
            <Dropdown.Item disabled={isLast} onSelect={() => onStep(1)}><Dropdown.ItemIcon as={IconArrowDown} />Move down</Dropdown.Item>
            <Dropdown.Item onSelect={onPromote}><Dropdown.ItemIcon as={IconArrowBarToUp} />Promote to task</Dropdown.Item>
            <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
            <Dropdown.Item onSelect={onDelete} className="text-error-base">
              <Dropdown.ItemIcon as={IconTrash} className="text-error-base" />Delete
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Root>
      </div>
    </li>
  );
}
```

Check `pointer-coarse:` is a configured Tailwind variant (it is used in `TaskCard.tsx`). Check `DueChip` returns null for null dates (it does in the list).

- [ ] **Step 4: Rewrite `SubtaskSection`**

Replace `src/components/task/SubtaskSection.tsx` with:

```tsx
'use client';

import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { IconPlus } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CollapsibleSection } from '@/components/task/CollapsibleSection';
import { SubtaskRow } from '@/components/task/SubtaskRow';
import { useSetParent } from '@/components/task/use-set-parent';
import { settle } from '@/lib/settle';
import { MAX_SUBTASK_BATCH, progressPercent, splitPastedLines, stepTarget } from '@/lib/subtasks';
import { dropTarget } from '@/lib/todo-list';
import type { MemberRow } from '@/server/labels/queries';
import type { StatusRow } from '@/server/projects/queries';
import { createSubtasksAction, createTaskAction, reorderSubtaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

export function SubtaskSection({
  parent, subtasks, statuses, members, timezone, projectId, workspaceSlug, pageBase,
}: {
  parent: TaskRow;
  subtasks: TaskRow[];
  statuses: StatusRow[];
  members: MemberRow[];
  timezone: string;
  projectId: string;
  workspaceSlug: string;
  /** Set on a task's own page: subtasks open as pages under it, not via ?task=. */
  pageBase?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setParent = useSetParent(workspaceSlug);

  // Local order for optimistic drags; the server's order wins on every refresh.
  const serverIds = useMemo(() => subtasks.map((s) => s.id), [subtasks]);
  const [order, setOrder] = useState(serverIds);
  useEffect(() => setOrder(serverIds), [serverIds]);
  const byId = useMemo(() => new Map(subtasks.map((s) => [s.id, s])), [subtasks]);
  const rows = order.map((id) => byId.get(id)).filter((s): s is TaskRow => s !== undefined);

  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;
  const percent = progressPercent(doneCount, subtasks.length);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function reorder(id: string, target: { toIndex: number; beforeId: string | null; afterId: string | null }) {
    const previous = order;
    setOrder(arrayMove(order, order.indexOf(id), target.toIndex));
    void settle(reorderSubtaskAction(workspaceSlug, { taskId: id, beforeId: target.beforeId, afterId: target.afterId }))
      .then((result) => {
        if (result.ok) return;
        toast.error(result.error);
        setOrder(previous);
        router.refresh();
      });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const target = dropTarget(order, String(active.id), String(over.id));
    if (target) reorder(String(active.id), target);
  }

  function onStep(id: string, delta: -1 | 1) {
    const target = stepTarget(order, id, delta);
    if (!target) return;
    reorder(id, target);
    // Keep the moved row focused for the next Alt+arrow.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-subtask-id="${id}"] button[aria-label^="Rename"]`)?.focus());
  }

  function open(id: string) {
    if (pageBase) {
      router.push(`${pageBase}/${id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  // Add row.
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [pasted, setPasted] = useState<string[] | null>(null);

  async function addOne(title: string) {
    setPending(true);
    const result = await settle(createTaskAction(workspaceSlug, {
      projectId, title,
      // Subtasks land in the parent's column: they are part of work already in flight.
      statusId: parent.statusId,
      parentTaskId: parent.id,
    }));
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      if (inputRef.current && inputRef.current.value === '') inputRef.current.value = title;
      return;
    }
    router.refresh();
  }

  async function addMany(titles: string[]) {
    setPasted(null);
    setPending(true);
    const result = await settle(createSubtasksAction(workspaceSlug, { parentTaskId: parent.id, titles }));
    setPending(false);
    if (!result.ok) toast.error(result.error);
    else router.refresh();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pasted) {
      void addMany(pasted);
      return;
    }
    const title = inputRef.current?.value.trim();
    if (!title || pending) return;
    // Cleared up front so the field is ready for the next one; never disabled, which would blur it.
    if (inputRef.current) inputRef.current.value = '';
    void addOne(title);
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const lines = splitPastedLines(event.clipboardData.getData('text/plain'));
    if (lines.length < 2) return;
    event.preventDefault();
    if (lines.length > MAX_SUBTASK_BATCH) {
      toast.error('Up to 50 at a time.');
      return;
    }
    setPasted(lines);
  }

  function pasteAsOneLine() {
    if (!pasted || !inputRef.current) return;
    inputRef.current.value = pasted.join(' ').slice(0, 200);
    setPasted(null);
  }

  return (
    <CollapsibleSection
      sectionId="subtasks"
      title="Subtasks"
      meta={`${doneCount}/${subtasks.length}`}
    >
      {subtasks.length > 0 && (
        <div
          role="progressbar"
          aria-label="Subtasks done"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 overflow-hidden rounded-full bg-bg-soft-200"
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-220', percent === 100 ? 'bg-success-base' : 'bg-primary-base')}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-10 ring-1 ring-inset ring-stroke-soft-200">
        {rows.length > 0 && (
          // An explicit id: dnd-kit's generated ids differ between server and browser render.
          <DndContext id={`subtasks-${parent.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul aria-label="Subtasks" className="border-b border-stroke-soft-200">
                {rows.map((subtask, i) => (
                  <SubtaskRow
                    key={subtask.id}
                    subtask={subtask}
                    statuses={statuses}
                    members={members}
                    timezone={timezone}
                    workspaceSlug={workspaceSlug}
                    isFirst={i === 0}
                    isLast={i === rows.length - 1}
                    onOpen={() => open(subtask.id)}
                    onStep={(delta) => onStep(subtask.id, delta)}
                    onPromote={() => setParent(subtask.id, null, parent.id, `“${subtask.title}” is now a task`)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <form onSubmit={onSubmit} data-local-escape="" className="flex items-center gap-2 px-3">
          <IconPlus className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
          <label htmlFor={`add-subtask-${parent.id}`} className="sr-only">Add a subtask</label>
          <input
            id={`add-subtask-${parent.id}`}
            ref={inputRef}
            name="title"
            maxLength={200}
            aria-busy={pending}
            placeholder="Add subtask…"
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && pasted && !e.defaultPrevented) {
                e.preventDefault();
                pasteAsOneLine();
              }
            }}
            className="h-11 w-full bg-transparent text-paragraph-md text-text-strong-950 placeholder:text-text-soft-400 lg:h-10 lg:text-paragraph-sm"
          />
        </form>
        {pasted && (
          <p role="status" className="border-t border-stroke-soft-200 px-3 py-2 text-paragraph-xs text-text-sub-600">
            <span className="text-text-strong-950">Create {pasted.length} subtasks?</span> Enter to confirm · Esc to paste as one line
          </p>
        )}
      </div>

      {subtasks.length === 0 && (
        <p className="text-paragraph-xs text-text-soft-400">Break this task into steps.</p>
      )}
    </CollapsibleSection>
  );
}
```

Escape while `pasted` is set: the dialog sees Escape first. Mirror the existing hand-off: add an effect that listens for `LOCAL_ESCAPE_EVENT` on the form and calls `pasteAsOneLine()` when `pasted` is set (copy the pattern from `SubtaskRow`'s rename). When `pasted` is null, let Escape fall through to close the dialog (do not mark the form `data-local-escape` then: render `data-local-escape={pasted ? '' : undefined}`). Read `src/lib/local-escape.ts` to confirm the attribute semantics before wiring.

- [ ] **Step 5: Wire props in `TaskDetailView`**

In `src/components/task/TaskDetailView.tsx:484-492`:

```tsx
          {!task.parentId && (
            <SubtaskSection
              parent={task}
              subtasks={task.subtasks}
              statuses={statuses}
              members={members}
              timezone={timezone}
              projectId={projectId}
              workspaceSlug={workspaceSlug}
              pageBase={mode === 'page' ? tasksBase : undefined}
            />
          )}
```

- [ ] **Step 6: Run checks and the targeted e2e**

Run:
```bash
yarn typecheck && yarn lint && yarn vitest run tests/unit
PORT=3100 yarn e2e tests/e2e/task-detail.spec.ts tests/e2e/board.spec.ts
```
Expected: PASS. (Memory: targeted e2e on :3100 only; e2e sign-up on :3100 was failing on 2026-10-08 — if sign-up fails for unrelated reasons, report it with output instead of claiming a pass, and verify manually in the browser.)

Manually verify in the browser (`yarn dev`): drag a row, Alt+↓ on a focused row, tick done (row stays put), change status/assignee/due from the row, Promote with Undo, row layout at 375px wide.

- [ ] **Step 7: Commit**

```bash
graphify update .
git add src/components/task tests/e2e/task-detail.spec.ts tests/e2e/board.spec.ts graphify-out
git commit -m "feat(subtasks): rich rows with inline edit, drag reorder and paste-to-many"
```

---

### Task 8: Opened subtask — banner, siblings, shortcuts

**Files:**
- Create: `src/components/task/SubtaskBanner.tsx`
- Modify: `src/components/task/TaskDetailView.tsx:160-170,268-280,310-316,~370`
- Modify: `src/lib/shortcuts/registry.ts:27-36`
- Test: `tests/unit/shortcut-registry.test.ts` (existing — must keep passing), `tests/e2e/subtasks.spec.ts`

**Interfaces:**
- Consumes: `TaskDetail.siblings`, `parentId`, `parentTitle` (Task 1).
- Produces: shortcut ids `'detail.prevSibling' | 'detail.nextSibling' | 'detail.parent'`.
- Produces: `SubtaskBanner` props `{ parentTitle: string; siblings: {id,title}[]; currentId: string; onGo(id: string): void }`.

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/subtasks.spec.ts` (sign-up helper copied from `task-detail.spec.ts` — keep it local to the file as the other specs do):

```ts
import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpAndOpenTask(page: Page, prefix: string, title = 'Launch') {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Subtask Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Subtasks ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await createTask(page, title);
  await page.getByRole('button', { name: title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog.getByLabel('Title')).toHaveValue(title);
  return dialog;
}

async function addSubtasks(page: Page, titles: string[]) {
  const input = page.getByRole('dialog').getByPlaceholder('Add subtask…');
  for (const t of titles) {
    await input.fill(t);
    await input.press('Enter');
    await expect(page.getByRole('dialog').getByRole('button', { name: `Rename “${t}”` })).toBeVisible();
  }
}

test('an opened subtask names its parent and steps between siblings', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'siblings');
  await addSubtasks(page, ['One', 'Two', 'Three']);

  await dialog.getByRole('button', { name: 'Open “Two”' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
  await expect(dialog.getByText('Subtask of')).toBeVisible();
  await expect(dialog.getByText('2 of 3')).toBeVisible();

  await dialog.getByRole('button', { name: 'Next subtask' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Three');
  await expect(dialog.getByRole('button', { name: 'Next subtask' })).toBeDisabled();

  // Shortcuts, with focus on the dialog body rather than a field.
  await dialog.getByText('Subtask of').click();
  await page.keyboard.press('[');
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
  await page.keyboard.press('u');
  await expect(dialog.getByLabel('Title')).toHaveValue('Launch');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts`
Expected: FAIL — no "Subtask of" text.

- [ ] **Step 3: Register shortcuts**

In `src/lib/shortcuts/registry.ts`, after `detail.comment`:

```ts
  { id: 'detail.prevSibling', keys: ['['], scope: 'detail', group: 'Task', label: 'Previous subtask (on a subtask)' },
  { id: 'detail.nextSibling', keys: [']'], scope: 'detail', group: 'Task', label: 'Next subtask (on a subtask)' },
  { id: 'detail.parent', keys: ['u'], scope: 'detail', group: 'Task', label: 'Go to parent task (on a subtask)' },
```

Run `yarn vitest run tests/unit/shortcut-registry.test.ts tests/unit/shortcut-keys.test.ts` — PASS. If `parseBinding` rejects `[` or `]`, extend `src/lib/shortcuts/keys.ts` to accept them and add a case to `tests/unit/shortcut-keys.test.ts`.

- [ ] **Step 4: Write `SubtaskBanner`**

```tsx
'use client';

import { IconChevronLeft, IconChevronRight, IconSubtask } from '@tabler/icons-react';
import { Hint } from '@/components/shell/ShortcutHint';

export function SubtaskBanner({
  parentTitle, siblings, currentId, onGo, onParent,
}: {
  parentTitle: string;
  siblings: { id: string; title: string }[];
  currentId: string;
  onGo: (id: string) => void;
  onParent: () => void;
}) {
  const index = siblings.findIndex((s) => s.id === currentId);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-stroke-soft-200 bg-bg-weak-50 px-5 py-2 text-paragraph-xs text-text-sub-600">
      <span className="flex min-w-0 items-center gap-1.5">
        <IconSubtask className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Subtask of</span>
        <button
          type="button"
          onClick={onParent}
          className="truncate font-medium text-text-strong-950 hover:underline"
        >
          {parentTitle}
        </button>
      </span>
      {index >= 0 && siblings.length > 1 && (
        <span className="flex shrink-0 items-center gap-1">
          <Hint label="Previous subtask ( [ )">
            <button type="button" aria-label="Previous subtask" disabled={!prev} onClick={() => prev && onGo(prev.id)}
              className="inline-flex size-7 items-center justify-center rounded-md hover:bg-bg-soft-200 disabled:opacity-40">
              <IconChevronLeft className="size-4" aria-hidden="true" />
            </button>
          </Hint>
          <span className="tabular">{index + 1} of {siblings.length}</span>
          <Hint label="Next subtask ( ] )">
            <button type="button" aria-label="Next subtask" disabled={!next} onClick={() => next && onGo(next.id)}
              className="inline-flex size-7 items-center justify-center rounded-md hover:bg-bg-soft-200 disabled:opacity-40">
              <IconChevronRight className="size-4" aria-hidden="true" />
            </button>
          </Hint>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into `TaskDetailView`**

Replace `openParent` with a general `goTo` and add shortcuts:

```tsx
  function goTo(id: string) {
    if (mode === 'page') {
      router.push(`${tasksBase}/${id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', id);
    router.push(`?${next.toString()}`, { scroll: false });
  }
  const openParent = () => goTo(task.parentId!);

  const siblingIndex = task.siblings.findIndex((s) => s.id === task.id);
  useShortcut('detail.prevSibling', () => {
    if (siblingIndex > 0) goTo(task.siblings[siblingIndex - 1].id);
  }, task.parentId !== null);
  useShortcut('detail.nextSibling', () => {
    if (siblingIndex >= 0 && siblingIndex < task.siblings.length - 1) goTo(task.siblings[siblingIndex + 1].id);
  }, task.parentId !== null);
  useShortcut('detail.parent', openParent, task.parentId !== null);
```

In the modal header, replace the `task.parentId ? (<button … chevron …>) : (…)` block with just `<span className="text-paragraph-xs text-text-sub-600">{task.parentId ? 'Subtask' : 'Task'}</span>`.

Right after `{header}` in the returned JSX:

```tsx
      {task.parentId && (
        <SubtaskBanner
          parentTitle={task.parentTitle ?? 'Parent task'}
          siblings={task.siblings}
          currentId={task.id}
          onGo={goTo}
          onParent={openParent}
        />
      )}
```

(Page mode keeps its breadcrumb; the banner shows in both modes.)

Update the board e2e from Task 7 Step 1: the back control is now the banner's button named exactly the parent title, so `dialog.getByRole('button', { name: 'Drag me', exact: true })` stays valid; drop the `.or(link)` alternative.

- [ ] **Step 6: Run checks**

```bash
yarn typecheck && yarn lint && yarn vitest run tests/unit
PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts tests/e2e/board.spec.ts tests/e2e/shortcuts.spec.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
graphify update .
git add src/components/task src/lib/shortcuts tests graphify-out
git commit -m "feat(subtasks): parent banner, sibling stepping and [ ] u shortcuts"
```

---

### Task 9: "Make subtask of…" picker and Promote in menus

**Files:**
- Create: `src/components/task/ParentPickerDialog.tsx`
- Modify: `src/components/task/TaskDetailView.tsx` (⋯ menu)
- Modify: `src/components/task/TaskRowActions.tsx`
- Modify: `src/components/task/TaskTable.tsx` (pass handlers)
- Test: `tests/e2e/subtasks.spec.ts`

**Interfaces:**
- Consumes: `parentCandidatesAction`, `useSetParent` (Tasks 3, 7).
- Produces: `ParentPickerDialog` props `{ open: boolean; onOpenChange(open: boolean): void; taskId: string; workspaceSlug: string; onPick(parent: { id: string; title: string }): void }`.
- Produces: `TaskRowActions` gains optional `onMakeSubtask?: () => void` and `onPromote?: () => void` (item shown only when provided).

- [ ] **Step 1: Write the failing e2e**

Append to `tests/e2e/subtasks.spec.ts`:

```ts
test('a task becomes a subtask of another and back, with Undo', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'convert', 'Launch');
  await page.keyboard.press('Escape');
  await createTask(page, 'Write copy');
  await page.getByRole('button', { name: 'Write copy', exact: true }).click();

  await dialog.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Make subtask of…' }).click();
  const picker = page.getByRole('dialog', { name: 'Make subtask of…' });
  await picker.getByRole('combobox').fill('Lau');
  await picker.getByRole('option', { name: 'Launch' }).click();

  await expect(page.getByText('“Write copy” is now a subtask of “Launch”')).toBeVisible();
  await expect(dialog.getByText('Subtask of')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.getByText('Subtask of')).toBeHidden();

  // And promote from the parent's row menu.
  await dialog.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Make subtask of…' }).click();
  await picker.getByRole('option', { name: 'Launch' }).click();
  await dialog.getByRole('button', { name: 'Launch', exact: true }).click();
  await dialog.getByRole('button', { name: 'More for “Write copy”' }).click();
  await page.getByRole('menuitem', { name: 'Promote to task' }).click();
  await expect(dialog.getByRole('button', { name: 'Rename “Write copy”' })).toBeHidden();
});
```

(Read the detail ⋯ trigger's actual accessible name in `TaskDetailView` `moreMenu` — use it in place of `'More actions'` if different.)

- [ ] **Step 2: Run to verify failure**

Run: `PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts -g "becomes a subtask"`
Expected: FAIL — no "Make subtask of…" item.

- [ ] **Step 3: Write `ParentPickerDialog`**

```tsx
'use client';

import { IconSearch, IconSubtask } from '@tabler/icons-react';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import * as Modal from '@/components/ui/modal';
import { settle } from '@/lib/settle';
import { parentCandidatesAction } from '@/server/tasks/actions';

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-paragraph-sm text-text-strong-950 data-[selected=true]:bg-bg-weak-50';

export function ParentPickerDialog({
  open, onOpenChange, taskId, workspaceSlug, onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  workspaceSlug: string;
  onPick: (parent: { id: string; title: string }) => void;
}) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    // Debounced: one request per pause in typing.
    const timer = setTimeout(() => {
      void settle(parentCandidatesAction(workspaceSlug, taskId, term)).then((result) => {
        if (stale) return;
        setLoading(false);
        setHits(result.ok ? result.data : []);
      });
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, term, taskId, workspaceSlug]);

  return (
    <Modal.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setTerm(''); }}>
      <Modal.Content className="max-w-md">
        <Modal.Header icon={IconSubtask} title="Make subtask of…" description="Pick a task in this project." />
        <Modal.Body className="p-0">
          <Command label="Parent task" shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-3">
              <IconSearch className="size-4 shrink-0 text-text-soft-400" aria-hidden="true" />
              <Command.Input
                value={term}
                onValueChange={setTerm}
                placeholder="Search tasks…"
                className="h-11 w-full bg-transparent text-paragraph-sm text-text-strong-950 outline-none placeholder:text-text-soft-400"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-1">
              {!loading && <Command.Empty className="p-3 text-paragraph-sm text-text-sub-600">No matching tasks</Command.Empty>}
              {hits.map((h) => (
                <Command.Item key={h.id} value={h.id} onSelect={() => { onOpenChange(false); onPick(h); }} className={itemClass}>
                  <span className="truncate">{h.title}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
```

Check `Modal.Header`'s props in `src/components/ui/modal.tsx` (it is used with `icon`, `title`, `description` in `ManageColumnsDialog`). A nested `Modal` over the task dialog: Radix supports stacked dialogs; verify Escape closes only the picker.

- [ ] **Step 4: Detail ⋯ menu items**

In `TaskDetailView`: add `const setParent = useSetParent(workspaceSlug); const [pickParent, setPickParent] = useState(false);` and in `moreMenu`'s `Dropdown.Content` before the Delete item:

```tsx
        {task.parentId ? (
          <Dropdown.Item onSelect={() => setParent(task.id, null, task.parentId, `“${task.title}” is now a task`)}>
            <Dropdown.ItemIcon as={IconArrowBarToUp} />
            Promote to task
          </Dropdown.Item>
        ) : (
          <Dropdown.Item
            disabled={task.subtasks.length > 0}
            title={task.subtasks.length > 0 ? 'Tasks with subtasks can’t become subtasks.' : undefined}
            onSelect={() => setPickParent(true)}
          >
            <Dropdown.ItemIcon as={IconSubtask} />
            Make subtask of…
          </Dropdown.Item>
        )}
        <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />
```

Render once, next to `<AttachmentPreviewModal …/>`:

```tsx
      <ParentPickerDialog
        open={pickParent}
        onOpenChange={setPickParent}
        taskId={task.id}
        workspaceSlug={workspaceSlug}
        onPick={(p) => setParent(task.id, p.id, null, `“${task.title}” is now a subtask of “${p.title}”`)}
      />
```

A disabled `Dropdown.Item` does not show a native `title` tooltip reliably; wrap the label text in `<Hint label="Tasks with subtasks can’t become subtasks.">` when disabled if the Hint works inside menu items (check `Hint` usage elsewhere), else keep `title`.

- [ ] **Step 5: List row actions**

`TaskRowActions`: add optional props and items:

```tsx
  onMakeSubtask?: () => void;
  onPromote?: () => void;
```

```tsx
        {(onMakeSubtask || onPromote) && <Dropdown.Separator className="my-1 h-px bg-stroke-soft-200" />}
        {onMakeSubtask && (
          <Dropdown.Item disabled={task.subtaskCount > 0} onSelect={onMakeSubtask}>
            <Dropdown.ItemIcon as={IconSubtask} />
            Make subtask of…
          </Dropdown.Item>
        )}
        {onPromote && (
          <Dropdown.Item onSelect={onPromote}>
            <Dropdown.ItemIcon as={IconArrowBarToUp} />
            Promote to task
          </Dropdown.Item>
        )}
```

placed just before the final separator + Delete.

`TaskTable`: hold `const [parentFor, setParentFor] = useState<TaskRow | null>(null); const setParent = useSetParent(workspaceSlug);`, pass `onMakeSubtask={() => setParentFor(row.original)}` for top-level rows (Task 11 passes `onPromote` for child rows), and render:

```tsx
      {parentFor && (
        <ParentPickerDialog
          open
          onOpenChange={(open) => { if (!open) setParentFor(null); }}
          taskId={parentFor.id}
          workspaceSlug={workspaceSlug}
          onPick={(p) => setParent(parentFor.id, p.id, null, `“${parentFor.title}” is now a subtask of “${p.title}”`)}
        />
      )}
```

- [ ] **Step 6: Run checks**

```bash
yarn typecheck && yarn lint
PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts tests/e2e/list-bulk.spec.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
graphify update .
git add src/components/task tests/e2e/subtasks.spec.ts graphify-out
git commit -m "feat(subtasks): make subtask of… and promote from menus, with undo"
```

---

### Task 10: Board card checklist

**Files:**
- Modify: `src/components/kibo-ui/kanban/index.tsx:114-200`
- Create: `src/components/board/CardSubtasks.tsx`
- Modify: `src/components/board/TaskCard.tsx`
- Modify: `src/components/board/BoardColumn.tsx`, `src/components/board/Board.tsx`
- Test: `tests/e2e/subtasks.spec.ts`

**Interfaces:**
- Consumes: `TaskRow.subtasks` (Task 4), `progressPercent`, `doneToggleTarget`, `updateTaskAction`.
- Produces: `KanbanCardProps.footer?: ReactNode`.
- Produces: `CardSubtasks` props `{ task: TaskRow; statuses: StatusRow[]; workspaceSlug: string; expanded: boolean; onToggle(): void; onOpen(id: string): void }`.
- Produces: `TaskCard` props gain `workspaceSlug: string; expanded: boolean; onToggleSubtasks(id: string): void`.

- [ ] **Step 1: Write the failing e2e**

```ts
test('a board card expands its subtasks; ticking one updates the count without opening the card', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'board-checklist');
  await addSubtasks(page, ['One', 'Two']);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]task=/);

  const toggle = page.getByRole('button', { name: 'Show subtasks of Launch' });
  await expect(toggle).toHaveText(/0\/2/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Mark “One” as done' }).click();
  await expect(toggle).toHaveText(/1\/2/);
  await expect(page).not.toHaveURL(/[?&]task=/);

  await page.getByRole('button', { name: 'Two', exact: true }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Two');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts -g "board card"`
Expected: FAIL.

- [ ] **Step 3: `KanbanCard` footer slot**

Add to `KanbanCardProps`:

```ts
  /**
   * Interactive content under the card body (the card itself is one button, so
   * nothing clickable can live inside it). With a footer the card's chrome
   * moves to a wrapper around both.
   */
  footer?: ReactNode;
```

Destructure `footer`. Split the chrome classes out of the button:

```tsx
  const chrome = 'rounded-10 bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 transition-shadow duration-150 hover:shadow-regular-sm';
```

The button's className becomes `cn('w-full cursor-grab p-3 text-left active:cursor-grabbing', !footer && chrome, isDragging && '…existing…', className)`; when `footer` is set and `isDragging`, hide the footer (`{footer && !isDragging && footer}`) and apply the dashed placeholder classes to the wrapper instead. Wrap:

```tsx
  const card = footer ? (
    <div className={cn(chrome, isDragging && 'pointer-events-none bg-primary-lighter shadow-none ring-0 outline-1 -outline-offset-1 outline-dashed outline-primary-base')}>
      {button}
      {!isDragging && footer}
    </div>
  ) : button;
```

and use `card` where `button` was used in the `<li>` (inside the `ViewTransition` too). Verify the drag overlay (`overlay.In` block) still renders the plain card (it clones the body; leave it unchanged).

- [ ] **Step 4: `CardSubtasks`**

```tsx
'use client';

import { IconChevronRight } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { DoneIcon, StrikeText } from '@/components/task/DoneMark';
import { settle } from '@/lib/settle';
import { progressPercent } from '@/lib/subtasks';
import { doneToggleTarget } from '@/lib/task-done';
import type { StatusRow } from '@/server/projects/queries';
import { updateTaskAction } from '@/server/tasks/actions';
import type { TaskRow } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const SHOWN = 5;

/** Stops a click or key from reaching the card (open) or dnd-kit (drag). */
const contain = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

export function CardSubtasks({
  task, statuses, workspaceSlug, expanded, onToggle, onOpen,
}: {
  task: TaskRow;
  statuses: StatusRow[];
  workspaceSlug: string;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const subtasks = task.subtasks ?? [];
  const percent = progressPercent(task.subtaskDoneCount, task.subtaskCount);

  function toggleDone(sub: TaskRow) {
    const target = doneToggleTarget(statuses, sub.completedAt !== null);
    if (!target) {
      toast.error('This project has no done column.');
      return;
    }
    startTransition(async () => {
      const result = await settle(updateTaskAction(workspaceSlug, { taskId: sub.id, statusId: target.id }));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div {...contain} className="px-3 pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'Show'} subtasks of ${task.title}`}
        onClick={onToggle}
        className="tabular -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-paragraph-xs text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950"
      >
        <IconChevronRight className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden="true" />
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-bg-soft-200" />
          <circle
            cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" pathLength={100}
            strokeDasharray={`${percent} 100`}
            className={percent === 100 ? 'stroke-success-base' : 'stroke-primary-base'}
          />
        </svg>
        {task.subtaskDoneCount}/{task.subtaskCount}
      </button>

      {expanded && (
        <ul className="mt-1 flex flex-col">
          {subtasks.slice(0, SHOWN).map((sub) => {
            const done = sub.completedAt !== null;
            return (
              <li key={sub.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={done}
                  aria-label={done ? `Mark “${sub.title}” as not done` : `Mark “${sub.title}” as done`}
                  onClick={() => toggleDone(sub)}
                  className="inline-flex size-7 shrink-0 items-center justify-center text-text-soft-400 hover:text-text-strong-950 disabled:opacity-50"
                >
                  <DoneIcon done={done} className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(sub.id)}
                  className={cn('min-w-0 flex-1 truncate py-1 text-left text-paragraph-xs', done ? 'text-text-soft-400' : 'text-text-strong-950')}
                >
                  <StrikeText done={done}>{sub.title}</StrikeText>
                </button>
                {sub.assigneeName && <AssigneeAvatar name={sub.assigneeName} image={sub.assigneeImage} />}
              </li>
            );
          })}
          {subtasks.length > SHOWN && (
            <li>
              <button type="button" onClick={() => onOpen(task.id)} className="py-1 pl-8 text-paragraph-xs text-primary-base hover:underline">
                +{subtasks.length - SHOWN} more
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

(Check `AssigneeAvatar` has a small size option; if not, wrap it in `<span className="scale-75">` or pass a className prop if it accepts one.)

- [ ] **Step 5: Wire `TaskCard`, `BoardColumn`, `Board`**

`TaskCard`: add props `workspaceSlug`, `expanded`, `onToggleSubtasks`; delete the in-body `subtaskCount` badge block; pass to `KanbanCard`:

```tsx
      footer={task.subtaskCount > 0 ? (
        <CardSubtasks
          task={task}
          statuses={statuses}
          workspaceSlug={workspaceSlug}
          expanded={expanded}
          onToggle={() => onToggleSubtasks(task.id)}
          onOpen={onOpen}
        />
      ) : undefined}
```

`Board.tsx`: `const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());` and

```tsx
  function toggleSubtasks(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
```

Thread `workspaceSlug`, `expanded`, `toggleSubtasks` through `BoardColumn` (`expandedIds: ReadonlySet<string>`, `onToggleSubtasks`) into `TaskCard` (`expanded={expandedIds.has(task.id)}`). State lives in `Board` so it survives `router.refresh()`.

- [ ] **Step 6: Run checks**

```bash
yarn typecheck && yarn lint
PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts tests/e2e/board.spec.ts tests/e2e/board-drag.spec.ts tests/e2e/motion.spec.ts
```
Expected: PASS. Manually: drag a card with an expanded checklist (footer hides while dragging, card lands normally), keyboard Space-lift on the card still works, mobile 375px.

- [ ] **Step 7: Commit**

```bash
graphify update .
git add src/components/kibo-ui/kanban/index.tsx src/components/board tests/e2e/subtasks.spec.ts graphify-out
git commit -m "feat(board): expand a card's subtasks as a checklist"
```

---

### Task 11: List child rows and expand all

**Files:**
- Modify: `src/components/task/TaskTable.tsx`
- Modify: `src/components/task/TaskTableSettings.tsx`
- Test: `tests/e2e/subtasks.spec.ts`

**Interfaces:**
- Consumes: `TaskRow.subtasks` (Task 4), `TaskRowActions.onPromote` (Task 9), `useSetParent`.
- Produces: `renderTaskCell(columnId: string, task: TaskRow, ctx: { statusById: Map<string, StatusRow>; timezone: string }): ReactNode` (module-level in `TaskTable.tsx`), used by both tanstack column defs and child rows.
- Produces: `TaskTableSettings` gains optional props `onExpandAll?: () => void; onCollapseAll?: () => void`.

- [ ] **Step 1: Write the failing e2e**

```ts
test('the list expands a parent into indented subtask rows', async ({ page }) => {
  await signUpAndOpenTask(page, 'list-children');
  await addSubtasks(page, ['One', 'Two']);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'List' }).click();

  const chevron = page.getByRole('button', { name: 'Show subtasks of Launch' }).first();
  await chevron.click();
  await expect(chevron).toHaveAttribute('aria-expanded', 'true');
  const table = page.getByRole('table');
  await expect(table.getByRole('button', { name: 'One', exact: true })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Two', exact: true })).toBeVisible();

  await table.getByRole('button', { name: 'Two', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task details' }).getByLabel('Title')).toHaveValue('Two');
});
```

(Check the actual accessible name of the List view tab in `ProjectHeader`; adjust `'List'` if needed.)

- [ ] **Step 2: Run to verify failure**

Run: `PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts -g "list expands"`
Expected: FAIL.

- [ ] **Step 3: Extract cell rendering**

In `TaskTable.tsx`, move each column's `cell` body into one function:

```tsx
type CellCtx = { statusById: Map<string, StatusRow>; timezone: string };

/** One cell's content, shared by tanstack rows and the hand-rendered subtask rows. */
function renderTaskCell(columnId: string, task: TaskRow, { statusById, timezone }: CellCtx): React.ReactNode {
  switch (columnId) {
    case 'title': { /* body of the current title cell, using `task` */ }
    case 'status': { /* … */ }
    case 'priority': { /* … */ }
    case 'assignee': { /* … */ }
    case 'due': { /* … */ }
    case 'created': return <InstantCell instant={task.createdAt} timezone={timezone} />;
    case 'updated': return <InstantCell instant={task.updatedAt} timezone={timezone} />;
    case 'labels': { /* … */ }
    default: return null;
  }
}
```

Copy each existing `cell: ({ row }) => …` body verbatim into its `case`, replacing `row.original` with `task`. Each column def then uses `cell: ({ row }) => renderTaskCell('<id>', row.original, { statusById, timezone })`. In the title case, drop the `subtaskDoneCount/subtaskCount` suffix for rows that have the chevron (the chevron shows the count) — keep it only when `task.subtasks === undefined`.

Run `yarn typecheck && PORT=3100 yarn e2e tests/e2e/views.spec.ts tests/e2e/list-bulk.spec.ts` — must still PASS before continuing (pure refactor).

- [ ] **Step 4: Expanded state, chevrons, child rows**

In `TaskTable`:

```tsx
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const setParent = useSetParent(workspaceSlug);
  const allTasks = useMemo(() => data.flatMap((t) => [t, ...(t.subtasks ?? [])]), [data]);
```

Change `selectedIds` to filter `allTasks` instead of `data` (so selected child rows count for the bulk bar). In `deleteTasks`, look titles up in `allTasks`.

Chevron, rendered in the title cell before the title button (inside the sticky title `<td>`, as a sibling of the title button so it is not nested):

```tsx
function Chevron({ task, open, onToggle }: { task: TaskRow; open: boolean; onToggle: () => void }) {
  if (!task.subtasks || task.subtasks.length === 0) return <span className="inline-block w-6 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} subtasks of ${task.title}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="tabular inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1 text-paragraph-xs text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
    >
      <IconChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} aria-hidden="true" />
      {task.subtaskDoneCount}/{task.subtaskCount}
    </button>
  );
}
```

In the title `<td>`, wrap content in `<span className="flex items-center gap-1">` with `<Chevron …/>` then the existing title button.

After each parent `<tr>` (inside the same `Fragment`), when `expanded.has(row.id)`, render one `<tr>` per child:

```tsx
                  {expanded.has(row.id) && (row.original.subtasks ?? []).map((sub) => {
                    const subSelected = selection.has(sub.id);
                    const subBg = subSelected ? 'bg-primary-lighter' : 'bg-bg-white-0 group-hover:bg-bg-weak-50';
                    return (
                      <tr key={sub.id} onClick={() => openTask(sub.id)} aria-selected={subSelected} className="group cursor-pointer">
                        <td
                          className={cn(cellBase, subBg, 'sticky left-0 z-10 w-10 min-w-10 rounded-l-xl pl-3 pr-0')}
                          onClick={(e) => { e.stopPropagation(); toggleRow(sub.id, false); }}
                        >
                          <span className="flex items-center">
                            <SelectBox label={`Select ${sub.title}`} checked={subSelected} onClick={(e) => { e.stopPropagation(); toggleRow(sub.id, false); }} />
                          </span>
                        </td>
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.column.id}
                            className={cn(cellBase, subBg, 'px-3', COLUMN_WIDTH[cell.column.id], cell.column.id === 'title' && 'sticky left-10 z-10 max-w-md')}
                          >
                            {cell.column.id === 'title' ? (
                              <span className="flex min-w-0 items-center gap-1 pl-6">
                                <IconCornerDownRight className="size-3.5 shrink-0 text-text-soft-400" aria-hidden="true" />
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openTask(sub.id); }}
                                  aria-label={sub.title}
                                  data-task-nav={sub.id}
                                  className="flex min-w-0 flex-1 text-left"
                                >
                                  {renderTaskCell('title', sub, { statusById, timezone })}
                                </button>
                              </span>
                            ) : renderTaskCell(cell.column.id, sub, { statusById, timezone })}
                          </td>
                        ))}
                        <td className={cn(cellBase, subBg, 'w-12 rounded-r-xl px-2')}>
                          <TaskRowActions
                            task={sub}
                            statuses={statuses}
                            timezone={timezone}
                            disabled={pending}
                            onOpen={() => openTask(sub.id)}
                            onPatch={(patch) => applyPatch([sub.id], patch)}
                            onDelete={() => deleteTasks([sub.id])}
                            onPromote={() => setParent(sub.id, null, row.id, `“${sub.title}” is now a task`)}
                          />
                        </td>
                      </tr>
                    );
                  })}
```

`toggleRow`'s shift-range uses `rows` ids; for child rows pass `shiftKey=false` (range select stays top-level only — keep it simple).

Phone list (`sm:hidden` `<ul>`): add the same `Chevron` before the row button and, when expanded, render child `<li>`s with `pl-8`, the `↳` icon, `StatusIcon`, title, `DueChip`, avatar, using the same markup as parent rows.

`IconCornerDownRight` from `@tabler/icons-react`.

- [ ] **Step 5: Expand all / Collapse all**

`TaskTableSettings`: add optional `onExpandAll`, `onCollapseAll` props and two buttons at the top of its popover/menu content, labelled "Expand all subtasks" / "Collapse all subtasks" (match its existing item component). In `TaskTable` pass:

```tsx
            <TaskTableSettings
              settings={settings}
              onChange={onSettingsChange}
              onReset={resetSettings}
              onExpandAll={() => setExpanded(new Set(data.filter((t) => (t.subtasks ?? []).length > 0).map((t) => t.id)))}
              onCollapseAll={() => setExpanded(new Set())}
            />
```

- [ ] **Step 6: Run checks**

```bash
yarn typecheck && yarn lint && yarn vitest run tests/unit
PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts tests/e2e/list-bulk.spec.ts tests/e2e/views.spec.ts tests/e2e/shortcuts.spec.ts tests/e2e/mobile.spec.ts
```
Expected: PASS. Manually: j/k walks into child rows, bulk-select a child row then set status from the bulk bar, sort by title (children stay under parents), 375px stacked view.

- [ ] **Step 7: Commit**

```bash
graphify update .
git add src/components/task tests/e2e/subtasks.spec.ts graphify-out
git commit -m "feat(list): expand parents into subtask rows, expand or collapse all"
```

---

### Task 12: Drag reorder e2e and full verification

**Files:**
- Test: `tests/e2e/subtasks.spec.ts`

- [ ] **Step 1: Add the reorder e2e**

```ts
test('subtasks reorder by keyboard and the order survives a reload and a done toggle', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'reorder');
  await addSubtasks(page, ['One', 'Two', 'Three']);
  const titles = dialog.getByRole('list', { name: 'Subtasks' }).getByRole('button', { name: /^Rename/ });

  await dialog.getByRole('button', { name: 'Rename “Three”' }).focus();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.keyboard.press('Alt+ArrowUp');
  await saved;
  await expect(titles).toHaveText(['One', 'Three', 'Two']);

  await dialog.getByRole('button', { name: 'Mark “One” as done' }).click();
  await expect(dialog.getByText('1/3')).toBeVisible();
  await expect(titles).toHaveText(['One', 'Three', 'Two']);

  await page.reload();
  await expect(titles).toHaveText(['One', 'Three', 'Two']);
});

test('row fields change status, assignee and due date in place', async ({ page }) => {
  const dialog = await signUpAndOpenTask(page, 'row-fields');
  await addSubtasks(page, ['Step']);

  await dialog.getByRole('button', { name: /^Status: / }).click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  await expect(dialog.getByRole('button', { name: 'Status: In Progress' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Assign' }).click();
  await page.getByRole('option', { name: /Subtask Tester/ }).click();
  await expect(dialog.getByRole('button', { name: 'Assignee: Subtask Tester' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Set due date' }).click();
  await page.getByRole('menuitem', { name: 'Tomorrow' }).click();
  await expect(dialog.getByRole('button', { name: /^Due date: / })).toBeVisible();
});
```

(Read the project's default status names in `src/server/projects/service.ts` — use the real second column name instead of `'In Progress'` if it differs.)

- [ ] **Step 2: Run the new e2e**

Run: `PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full verification**

```bash
yarn typecheck
yarn lint
yarn test
PORT=3100 yarn e2e tests/e2e/subtasks.spec.ts tests/e2e/task-detail.spec.ts tests/e2e/board.spec.ts tests/e2e/board-drag.spec.ts tests/e2e/list-bulk.spec.ts tests/e2e/views.spec.ts tests/e2e/shortcuts.spec.ts tests/e2e/mobile.spec.ts tests/e2e/live-refresh.spec.ts
yarn build
```
Expected: all PASS; report any failure with its output rather than claiming success.

- [ ] **Step 4: Commit**

```bash
graphify update .
git add tests/e2e/subtasks.spec.ts graphify-out
git commit -m "test(subtasks): e2e for reorder, row fields, board and list"
```

- [ ] **Step 5: Record deploy note**

Tell the user: production needs `yarn db:setup:prod` after deploy (adds `task.subtask_position` and runs `subtask-position-backfill.sql`). Do not push or open a PR without being asked.
