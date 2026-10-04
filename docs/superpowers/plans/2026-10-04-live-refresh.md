# Live Refresh (polling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teammate's change to shared workspace data appears on every member's open page within ~30 s (at once on tab focus), without a reload and without interrupting a drag, typing or an in-flight save.

**Architecture:** Every shared-data mutation in `src/server/**/service.ts` bumps a per-workspace counter (`workspace_change.version`) inside its own transaction through one helper, `emitChange`. The workspace layout renders the current version into a client `<LiveRefresh>`, which polls `GET /api/workspaces/[slug]/changes` through a `ChangeTransport` and calls `router.refresh()` when the polled version passes the rendered one and the page is idle. Pusher later = a second transport + one publish call inside `emitChange`.

**Tech Stack:** Next.js 16 App Router (route handlers, `router.refresh`), Drizzle ORM on Postgres, Vitest (node + jsdom), Playwright, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-10-04-live-refresh-design.md`

## Global Constraints

- Yarn 4; no new dependencies (everything here uses what is installed: drizzle, next, dnd-kit, jsdom, pg).
- `ctx: WorkspaceContext` first parameter on every `src/server/**` export; `emitChangeFor(workspaceId, tx)` is the only exception, for callers that have no context (invitations, cron, account deletion).
- `Result<T>` across the action boundary; services keep their existing return shapes.
- No component imports from `src/db/`.
- New tables go in the `TRUNCATE` list in `tests/setup/db.ts`.
- TDD: failing test first, then code.
- Conventional Commits; **no `Co-Authored-By` trailer** (user rule).
- Never push, never open a PR, never bump `package.json` version unless the user says so.
- Run `graphify update .` after code changes (repo rule) — before each commit is fine.
- Next.js here has breaking changes vs. training data: before writing the route handler, read `node_modules/next/dist/docs/` for route handlers (`params` is a Promise, as in `src/app/api/attachments/[id]/route.ts`).
- Interval 30 s visible; immediate check on `focus` / `visibilitychange`→visible; 2 min after 5 min with no `pointerdown`/`keydown`; nothing while hidden.
- Private writes never emit: todos, project stars, private saved views, own reminders, notification reads.

## Review Focus

1. **Removed from the workspace or signed out mid-session** — the poll gets 404/401 and must stop for good, not hammer the endpoint or loop refreshes. Pinned in Task 6 (transport "stops on 401/404").
2. **A burst of teammate edits while I am busy** — must collapse into exactly one refresh when I go idle, not one per change. Pinned in Task 6 (refresher "collapses").
3. **My own edit echoing back through the poll** — the poll can see my bump before my action's response re-renders the layout; once the prop catches up, no second refresh. Pinned in Task 6 (refresher "seen catches up").
4. **A refused or rolled-back write** (e.g. deleting the last open column) — must not bump the counter, or every member refreshes for nothing. Pinned in Task 2 (statuses "refused delete") and Task 2 tasks "refused create".
5. **Focus on a checkbox or button** (List bulk-select checkboxes, the Board tab) — must not count as typing, or a refresh would be blocked indefinitely. Pinned in Task 6 (busy "checkbox is not typing").

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/change.ts` (new) | `workspace_change` table |
| `src/db/schema/index.ts` | export it |
| `tests/setup/db.ts` | add to TRUNCATE |
| `src/server/changes/service.ts` (new) | `emitChange`, `emitChangeFor` |
| `src/server/changes/queries.ts` (new) | `getWorkspaceVersion`, `pollWorkspaceVersion` |
| `src/server/{tasks,statuses,projects,comments,attachments,labels,members,settings,views}/service.ts` | call the emit |
| `src/server/reminders/run.ts`, `src/server/account/deletion.ts` | call `emitChangeFor` |
| `src/app/api/workspaces/[slug]/changes/route.ts` (new) | poll endpoint |
| `src/lib/request-tracker.ts` | `LIVE_POLL_HEADER`, skip it |
| `src/lib/live/transport.ts` (new) | `ChangeTransport`, `createPollingTransport` |
| `src/lib/live/busy.ts` (new) | drag registry, `isTextEntry`, `isBusy`, `subscribeBusy` |
| `src/lib/live/use-drag-busy.ts` (new) | `useDragBusy(key)` hook |
| `src/lib/live/refresher.ts` (new) | pure seen/latest/flush logic |
| `src/components/shell/LiveRefresh.tsx` (new) | glue: transport + busy + refresher + router |
| `src/app/(app)/[workspaceSlug]/layout.tsx` | read version, mount `<LiveRefresh>` |
| `src/components/board/Board.tsx`, `src/components/calendar/CalendarMonth.tsx`, `src/components/board/ManageColumnsDialog.tsx`, `src/components/task/TaskTableSettings.tsx` | mark drags busy |
| `tests/server/changes.test.ts` (new) | counter + every emitting service |
| `tests/server/reminder-run.test.ts`, `tests/server/account-deletion.test.ts` | cron / deletion emits |
| `tests/unit/changes-route.test.ts` (new) | endpoint |
| `tests/unit/request-tracker.test.ts` | header skip |
| `tests/unit/live-transport.test.ts`, `tests/unit/live-busy.test.ts`, `tests/unit/live-refresher.test.ts` (new) | client logic |
| `tests/e2e/live-refresh.spec.ts` (new) | two members, two contexts |

---

### Task 1: Change counter table and helpers

**Files:**
- Create: `src/db/schema/change.ts`, `src/server/changes/service.ts`, `src/server/changes/queries.ts`, `tests/server/changes.test.ts`
- Modify: `src/db/schema/index.ts`, `tests/setup/db.ts`

**Interfaces:**
- Produces:
  - `workspaceChange` table export from `@/db`
  - `type Executor = typeof db | Tx` and `type ChangeScope = { projectId?: string | null }` from `@/server/changes/service`
  - `emitChange(ctx: WorkspaceContext, scope: ChangeScope, tx: Executor): Promise<void>`
  - `emitChangeFor(workspaceId: string, tx: Executor): Promise<void>`
  - `getWorkspaceVersion(ctx: WorkspaceContext): Promise<number>` from `@/server/changes/queries`
  - `pollWorkspaceVersion(userId: string, slug: string): Promise<number | null>` (null = not a member / no such slug)

- [ ] **Step 1: Write the failing test** — create `tests/server/changes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion, pollWorkspaceVersion } from '@/server/changes/queries';
import { emitChange, emitChangeFor } from '@/server/changes/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(slug = 'acme') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
  };
  return { ctx, ws, ada };
}

describe('workspace change counter', () => {
  it('reads 0 before anything changed', async () => {
    const { ctx } = await setup();
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('goes up by one per emit, with or without a context', async () => {
    const { ctx } = await setup();
    await emitChange(ctx, {}, db);
    await emitChangeFor(ctx.workspaceId, db);
    expect(await getWorkspaceVersion(ctx)).toBe(2);
  });

  it('rolls back with the transaction it ran in', async () => {
    const { ctx } = await setup();
    await db
      .transaction(async (tx) => {
        await emitChange(ctx, { projectId: null }, tx);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('keeps workspaces apart', async () => {
    const a = await setup('acme');
    const b = await setup('globex');
    await emitChange(a.ctx, {}, db);
    expect(await getWorkspaceVersion(b.ctx)).toBe(0);
  });
});

describe('pollWorkspaceVersion', () => {
  it('answers a member with the version', async () => {
    const { ctx, ada } = await setup();
    await emitChange(ctx, {}, db);
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(1);
  });

  it('answers 0 for a workspace that never changed', async () => {
    const { ada } = await setup();
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(0);
  });

  it('answers null to a non-member and for an unknown slug alike', async () => {
    await setup('acme');
    const { ada: outsider } = await setup('globex');
    expect(await pollWorkspaceVersion(outsider.id, 'acme')).toBeNull();
    expect(await pollWorkspaceVersion(outsider.id, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/server/changes.test.ts`
Expected: FAIL — `Cannot find module '@/server/changes/queries'`.

- [ ] **Step 3: Write the table** — create `src/db/schema/change.ts`:

```ts
import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

/**
 * One counter per workspace, bumped by every write to shared data in the same
 * transaction as the write (src/server/changes/service.ts). Open pages poll it
 * and refresh when it moves. No row = version 0.
 */
export const workspaceChange = pgTable('workspace_change', {
  workspaceId: text('workspace_id').primaryKey().references(() => organization.id, { onDelete: 'cascade' }),
  version: bigint('version', { mode: 'number' }).notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Append to `src/db/schema/index.ts`:

```ts
export * from './change';
```

In `tests/setup/db.ts`, change the first list line from `notification, reminder, saved_view,` to:

```ts
      workspace_change, notification, reminder, saved_view,
```

- [ ] **Step 4: Write the service** — create `src/server/changes/service.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The mutation's own transaction, or db for a write that has none. */
export type Executor = typeof db | Tx;

/**
 * What changed. No projectId = anything in the workspace may have changed.
 * Polling ignores it today; a Pusher publish will send it, so clients can skip
 * changes to projects they are not looking at.
 */
export type ChangeScope = { projectId?: string | null };

/** Bumps the workspace counter for callers that have no WorkspaceContext. */
export async function emitChangeFor(workspaceId: string, tx: Executor): Promise<void> {
  await tx
    .insert(workspaceChange)
    .values({ workspaceId, version: 1 })
    .onConflictDoUpdate({
      target: workspaceChange.workspaceId,
      set: { version: sql`${workspaceChange.version} + 1`, changedAt: sql`now()` },
    });
}

/**
 * Tells open pages that shared workspace data changed. Call it inside the
 * mutation's transaction, after the write, so a rolled-back write never bumps.
 * When Pusher lands, this also queues a publish of `scope` to run after commit.
 */
export async function emitChange(ctx: WorkspaceContext, scope: ChangeScope, tx: Executor): Promise<void> {
  await emitChangeFor(ctx.workspaceId, tx);
}
```

- [ ] **Step 5: Write the queries** — create `src/server/changes/queries.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db, member, organization, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export async function getWorkspaceVersion(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ version: workspaceChange.version })
    .from(workspaceChange)
    .where(eq(workspaceChange.workspaceId, ctx.workspaceId))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * The poll endpoint's one read: the counter, only for a member. null for a
 * non-member and for an unknown slug alike, so the answer leaks nothing.
 */
export async function pollWorkspaceVersion(userId: string, slug: string): Promise<number | null> {
  const [row] = await db
    .select({ version: workspaceChange.version })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .leftJoin(workspaceChange, eq(workspaceChange.workspaceId, organization.id))
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!row) return null;
  return row.version ?? 0;
}
```

- [ ] **Step 6: Push the schema to the local databases**

Run: `yarn db:setup:test && yarn db:setup`
Expected: drizzle-kit reports creating `workspace_change`; no other diff. (Do **not** run `db:setup:dev` / `db:setup:prod`; those are the user's call before deploy.)

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn vitest run tests/server/changes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Typecheck, update graph, commit**

```bash
yarn typecheck && graphify update .
git add src/db/schema/change.ts src/db/schema/index.ts tests/setup/db.ts src/server/changes tests/server/changes.test.ts
git commit -m "feat(live): workspace change counter"
```

---

### Task 2: Emit from task, column and project writes

**Files:**
- Modify: `src/server/tasks/service.ts`, `src/server/statuses/service.ts`, `src/server/projects/service.ts`
- Test: `tests/server/changes.test.ts`

**Interfaces:**
- Consumes: `emitChange`, `getWorkspaceVersion` (Task 1).
- Produces: test helpers `delta` and `seeded` inside `tests/server/changes.test.ts`, used by Tasks 3–4.

- [ ] **Step 1: Write the failing tests** — in `tests/server/changes.test.ts`, extend the imports:

```ts
import { PROJECT_COLOR_KEYS } from '@/components/brand/tint';
import type { Result } from '@/lib/result';
import { getProject } from '@/server/projects/queries';
import {
  archiveProject, createProject, deleteProject, renameProject, setProjectColor, setProjectStar, unarchiveProject,
} from '@/server/projects/service';
import { createStatus, deleteStatus, moveStatus, updateStatus } from '@/server/statuses/service';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
} from '@/server/tasks/service';
```

Add below `setup`:

```ts
/** How far one call moved the counter. Also asserts whether the call succeeded. */
async function delta(ctx: WorkspaceContext, run: () => Promise<Result<unknown>>, expectOk = true): Promise<number> {
  const before = await getWorkspaceVersion(ctx);
  const result = await run();
  expect(result.ok, result.ok ? undefined : result.error).toBe(expectOk);
  return (await getWorkspaceVersion(ctx)) - before;
}

/** A workspace with one project (Todo / In Progress / Done) and one task in Todo. */
async function seeded(slug = 'acme') {
  const base = await setup(slug);
  const project = await createProject(base.ctx, { name: 'Website' });
  if (!project.ok) throw new Error(project.error);
  const statuses = (await getProject(base.ctx, project.data.id))!.statuses;
  const made = await createTask(base.ctx, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error(made.error);
  return { ...base, projectId: project.data.id, statuses, taskId: made.data.id };
}
```

Append:

```ts
describe('task writes bump the counter', () => {
  it('createTask', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: 'More' }))).toBe(1);
  });

  it('a refused create does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: '   ' }), false)).toBe(0);
  });

  it('updateTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => updateTask(ctx, { taskId, title: 'Renamed' }))).toBe(1);
  });

  it('moveTask', async () => {
    const { ctx, taskId, statuses } = await seeded();
    expect(await delta(ctx, () => moveTask(ctx, { taskId, statusId: statuses[1].id, beforeId: null, afterId: null }))).toBe(1);
  });

  it('deleteTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => deleteTask(ctx, { taskId }))).toBe(1);
  });

  it('bulkUpdateTasks bumps once for the whole set', async () => {
    const { ctx, projectId, taskId } = await seeded();
    const other = await createTask(ctx, { projectId, title: 'Other' });
    if (!other.ok) throw new Error(other.error);
    expect(await delta(ctx, () => bulkUpdateTasks(ctx, { taskIds: [taskId, other.data.id], patch: { priority: 'high' } }))).toBe(1);
  });

  it('bulkDeleteTasks', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => bulkDeleteTasks(ctx, { taskIds: [taskId] }))).toBe(1);
  });
});

describe('column writes bump the counter', () => {
  it('createStatus', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createStatus(ctx, { projectId, name: 'Review' }))).toBe(1);
  });

  it('updateStatus, but not an empty update', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id, name: 'Backlog' }))).toBe(1);
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id }))).toBe(0);
  });

  it('moveStatus', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => moveStatus(ctx, { statusId: statuses[0].id, beforeId: statuses[2].id, afterId: null }))).toBe(1);
  });

  it('deleteStatus', async () => {
    const { ctx, statuses } = await seeded();
    // In Progress is empty; the seeded task sits in Todo.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[1].id }))).toBe(1);
  });

  it('a refused delete rolls back and does not bump', async () => {
    const { ctx, statuses } = await seeded();
    // Todo holds a task and no target is named.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[0].id }), false)).toBe(0);
  });
});

describe('project writes bump the counter', () => {
  it('createProject', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => createProject(ctx, { name: 'Docs' }))).toBe(1);
  });

  it('rename, color, archive, unarchive, delete', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => renameProject(ctx, { projectId, name: 'Site' }))).toBe(1);
    expect(await delta(ctx, () => setProjectColor(ctx, { projectId, color: PROJECT_COLOR_KEYS[1] }))).toBe(1);
    expect(await delta(ctx, () => archiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => unarchiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => deleteProject(ctx, { projectId }))).toBe(1);
  });

  it('a rename of an unknown project does not', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => renameProject(ctx, { projectId: 'nope', name: 'X' }), false)).toBe(0);
  });

  it('starring is private and does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => setProjectStar(ctx, { projectId, starred: true }))).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/changes.test.ts`
Expected: FAIL — the bump tests report `expected 0 to be 1`; the "does not" tests pass.

- [ ] **Step 3: Emit from `src/server/tasks/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createTask` — inside the transaction, after `recordActivity(...)`:

```ts
      await recordActivity(ctx, { taskId: id, kind: 'created', to: parsed.data.title }, tx);
      await emitChange(ctx, { projectId: parsed.data.projectId }, tx);
      return ok({ id });
```

`updateTask` — replace `return db.transaction((tx) => applyUpdate(ctx, tx, plan.data));` with:

```ts
    return db.transaction(async (tx) => {
      const result = await applyUpdate(ctx, tx, plan.data);
      if (result.ok) await emitChange(ctx, { projectId: plan.data.owned.projectId }, tx);
      return result;
    });
```

`moveTask` — just before the final `return ok({ position });` inside the transaction:

```ts
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return ok({ position });
```

`deleteTask` — inside the transaction, after the delete:

```ts
      await tx.delete(task).where(eq(task.id, input.taskId));
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return found;
```

`bulkUpdateTasks` — inside the transaction, after the `for` loop (one bump for the set; `applyUpdate` itself does not emit):

```ts
        for (const plan of plans) {
          const result = await applyUpdate(ctx, tx, plan);
          if (!result.ok) throw new RolledBack(result);
        }
        await emitChange(ctx, {}, tx);
```

`bulkDeleteTasks` — inside the transaction, after `.returning(...)`:

```ts
      if (rows.length > 0) await emitChange(ctx, {}, tx);
      return { deleted: rows.length, keys: found };
```

- [ ] **Step 4: Emit from `src/server/statuses/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createStatus` — after the insert, before `return ok({ id });`:

```ts
      await emitChange(ctx, { projectId: parsed.data.projectId }, tx);
      return ok({ id });
```

`updateStatus` — at the end of the transaction callback, after the `if (flipsDone) { ... }` block:

```ts
      await emitChange(ctx, { projectId: owned.projectId }, tx);
    });
```

`moveStatus` — before **both** `return ok({ position });` lines inside the transaction:

```ts
        await emitChange(ctx, { projectId: owned.projectId }, tx);
        return ok({ position });
```

`deleteStatus` — after `await tx.delete(taskStatus)...`:

```ts
      await tx.delete(taskStatus).where(eq(taskStatus.id, owned.id));
      await emitChange(ctx, { projectId: owned.projectId }, tx);

      return ok(null);
```

- [ ] **Step 5: Emit from `src/server/projects/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createProject` — inside the transaction, after the status insert:

```ts
    await emitChange(ctx, { projectId: id }, tx);
  });
```

`renameProject` — replace the `const updated = await db.update(project)...returning(...)` statement with:

```ts
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(project)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .returning({ id: project.id });
    if (rows.length > 0) await emitChange(ctx, { projectId: parsed.data.projectId }, tx);
    return rows;
  });
```

`setProjectColor` — same shape:

```ts
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(project)
      .set({ color: parsed.data.color, updatedAt: new Date() })
      .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId)))
      .returning({ id: project.id });
    if (rows.length > 0) await emitChange(ctx, { projectId: parsed.data.projectId }, tx);
    return rows;
  });
```

`archiveProject`:

```ts
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(project)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId), isNull(project.archivedAt),
      ))
      .returning({ id: project.id });
    if (rows.length > 0) await emitChange(ctx, { projectId: input.projectId }, tx);
    return rows;
  });
```

`unarchiveProject`:

```ts
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(project)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(
        eq(project.id, input.projectId), eq(project.workspaceId, ctx.workspaceId), isNotNull(project.archivedAt),
      ))
      .returning({ id: project.id });
    if (rows.length > 0) await emitChange(ctx, { projectId: input.projectId }, tx);
    return rows;
  });
```

`deleteProject` — inside the transaction, after the project delete:

```ts
    await emitChange(ctx, { projectId: input.projectId }, tx);

    return { result: ok(null), keys };
```

`setProjectStar` — unchanged (private).

- [ ] **Step 6: Run the new tests and the suites they touch**

Run: `yarn vitest run tests/server/changes.test.ts tests/server/tasks.test.ts tests/server/statuses.test.ts tests/server/projects.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, update graph, commit**

```bash
yarn typecheck && graphify update .
git add src/server/tasks/service.ts src/server/statuses/service.ts src/server/projects/service.ts tests/server/changes.test.ts
git commit -m "feat(live): task, column and project writes bump the change counter"
```

---

### Task 3: Emit from comment, attachment and label writes

**Files:**
- Modify: `src/server/comments/service.ts`, `src/server/attachments/service.ts`, `src/server/labels/service.ts`
- Test: `tests/server/changes.test.ts`

**Interfaces:**
- Consumes: `emitChange` (Task 1); `delta`, `seeded` helpers (Task 2).

- [ ] **Step 1: Write the failing tests** — extend imports in `tests/server/changes.test.ts`:

```ts
import { uploadTo } from '../setup/storage';
import { cancelUpload, confirmUpload, deleteAttachment, requestUpload } from '@/server/attachments/service';
import { createComment, deleteComment, updateComment } from '@/server/comments/service';
import { createLabel, deleteLabel, setTaskLabels } from '@/server/labels/service';
```

Append:

```ts
describe('comment writes bump the counter', () => {
  it('create, edit, delete', async () => {
    const { ctx, taskId } = await seeded();
    let commentId = '';
    expect(await delta(ctx, async () => {
      const r = await createComment(ctx, { taskId, body: 'Hi' });
      if (r.ok) commentId = r.data.id;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => updateComment(ctx, { commentId, body: 'Hello' }))).toBe(1);
    expect(await delta(ctx, () => deleteComment(ctx, { commentId }))).toBe(1);
  });
});

describe('attachment writes', () => {
  async function requested(ctx: WorkspaceContext, taskId: string) {
    const body = new TextEncoder().encode('hello');
    const req = await requestUpload(ctx, { taskId, fileName: 'a.txt', contentType: 'text/plain', size: body.length });
    if (!req.ok) throw new Error(req.error);
    await uploadTo(req.data.url, body, req.data.contentType);
    return req.data.id;
  }

  it('an unconfirmed upload is invisible to others and does not bump', async () => {
    const { ctx, taskId } = await seeded();
    const before = await getWorkspaceVersion(ctx);
    const attachmentId = await requested(ctx, taskId);
    expect(await delta(ctx, () => cancelUpload(ctx, { attachmentId }))).toBe(0);
    expect(await getWorkspaceVersion(ctx)).toBe(before);
  });

  it('confirm and delete do', async () => {
    const { ctx, taskId } = await seeded();
    const attachmentId = await requested(ctx, taskId);
    expect(await delta(ctx, () => confirmUpload(ctx, { attachmentId }))).toBe(1);
    expect(await delta(ctx, () => deleteAttachment(ctx, { attachmentId }))).toBe(1);
  });
});

describe('label writes', () => {
  it('create bumps; asking for an existing name does not', async () => {
    const { ctx } = await seeded();
    expect(await delta(ctx, () => createLabel(ctx, { name: 'Bug' }))).toBe(1);
    expect(await delta(ctx, () => createLabel(ctx, { name: 'Bug' }))).toBe(0);
  });

  it('setTaskLabels and deleteLabel bump', async () => {
    const { ctx, taskId } = await seeded();
    const made = await createLabel(ctx, { name: 'Bug' });
    if (!made.ok) throw new Error(made.error);
    expect(await delta(ctx, () => setTaskLabels(ctx, { taskId, labelIds: [made.data.id] }))).toBe(1);
    expect(await delta(ctx, () => deleteLabel(ctx, { labelId: made.data.id }))).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/changes.test.ts`
Expected: FAIL in the comment / attachment confirm+delete / label bump tests (`expected 0 to be 1`). MinIO must be up (`yarn db:up`).

- [ ] **Step 3: Emit from `src/server/comments/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createComment` — replace `await db.insert(comment).values({...});` with:

```ts
    await db.transaction(async (tx) => {
      await tx.insert(comment).values({
        id,
        workspaceId: ctx.workspaceId,
        taskId: parsed.data.taskId,
        // From the context, never the input.
        authorId: ctx.userId,
        body: parsed.data.body,
      });
      await emitChange(ctx, {}, tx);
    });
```

`updateComment` — replace the update statement with:

```ts
    await db.transaction(async (tx) => {
      await tx
        .update(comment)
        .set({ body: parsed.data.body, editedAt: new Date() })
        .where(eq(comment.id, parsed.data.commentId));
      await emitChange(ctx, {}, tx);
    });
```

`deleteComment` — replace the delete statement with:

```ts
    await db.transaction(async (tx) => {
      await tx.delete(comment).where(eq(comment.id, input.commentId));
      await emitChange(ctx, {}, tx);
    });
```

- [ ] **Step 4: Emit from `src/server/attachments/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`confirmUpload` — inside the transaction, after `recordActivity(...)`:

```ts
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_added', to: row.fileName }, tx);
      await emitChange(ctx, {}, tx);
      return true;
```

`deleteAttachment` — inside the transaction, after `recordActivity(...)`:

```ts
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_removed', from: row.fileName }, tx);
      await emitChange(ctx, {}, tx);
      return true;
```

`requestUpload`, `cancelUpload` — unchanged.

- [ ] **Step 5: Emit from `src/server/labels/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createLabel` — replace the `const [inserted] = await db.insert(label)...` line with:

```ts
    const [inserted] = await db.transaction(async (tx) => {
      const rows = await tx.insert(label).values(row).onConflictDoNothing().returning({ id: label.id });
      if (rows.length > 0) await emitChange(ctx, {}, tx);
      return rows;
    });
```

`setTaskLabels` — inside the existing transaction, after the insert block:

```ts
      await emitChange(ctx, { projectId: owned.projectId }, tx);
    });
```

`deleteLabel` — replace the delete statement with:

```ts
    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(label)
        .where(and(eq(label.id, input.labelId), eq(label.workspaceId, ctx.workspaceId)))
        .returning({ id: label.id });
      if (rows.length > 0) await emitChange(ctx, {}, tx);
      return rows;
    });
```

- [ ] **Step 6: Run the new tests and the suites they touch**

Run: `yarn vitest run tests/server/changes.test.ts tests/server/comments.test.ts tests/server/attachments.test.ts tests/server/labels.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, update graph, commit**

```bash
yarn typecheck && graphify update .
git add src/server/comments/service.ts src/server/attachments/service.ts src/server/labels/service.ts tests/server/changes.test.ts
git commit -m "feat(live): comment, attachment and label writes bump the change counter"
```

---

### Task 4: Emit from members, invitations, settings, shared views, the cron and account deletion

**Files:**
- Modify: `src/server/members/service.ts`, `src/server/settings/service.ts`, `src/server/views/service.ts`, `src/server/reminders/run.ts`, `src/server/account/deletion.ts`
- Test: `tests/server/changes.test.ts`, `tests/server/reminder-run.test.ts`, `tests/server/account-deletion.test.ts`

**Interfaces:**
- Consumes: `emitChange`, `emitChangeFor`, `getWorkspaceVersion` (Task 1); `delta`, `setup` helpers (Tasks 1–2).

- [ ] **Step 1: Write the failing tests** — extend imports in `tests/server/changes.test.ts`:

```ts
import { joinWorkspace } from '../setup/factories';
import {
  acceptInvitation, changeMemberRole, declineInvitation, inviteMember, removeMember,
} from '@/server/members/service';
import { updateWorkspaceSettings } from '@/server/settings/service';
import { createView, deleteView, duplicateView, updateView } from '@/server/views/service';
```

(Merge `joinWorkspace` into the existing `../setup/factories` import line.)

Append:

```ts
describe('member writes bump the counter', () => {
  it('invite, then accept by the invitee', async () => {
    const { ctx } = await setup();
    const bob = await createUser('bob@example.com', 'Bob');
    let invitationId = '';
    expect(await delta(ctx, async () => {
      const r = await inviteMember(ctx, { email: bob.email, role: 'member' });
      if (r.ok) invitationId = r.data.invitationId;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => acceptInvitation(bob.id, bob.email, invitationId))).toBe(1);
  });

  it('decline by the invitee', async () => {
    const { ctx } = await setup();
    const invited = await inviteMember(ctx, { email: 'bob@example.com', role: 'member' });
    if (!invited.ok) throw new Error(invited.error);
    expect(await delta(ctx, () => declineInvitation('bob@example.com', invited.data.invitationId))).toBe(1);
  });

  it('role change and removal', async () => {
    const { ctx, ws } = await setup();
    const bob = await createUser('bob@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    expect(await delta(ctx, () => changeMemberRole(ctx, { userId: bob.id, role: 'admin' }))).toBe(1);
    expect(await delta(ctx, () => removeMember(ctx, { userId: bob.id }))).toBe(1);
  });
});

describe('workspace settings', () => {
  it('a change bumps; an empty one does not', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => updateWorkspaceSettings(ctx, { weekStart: 1 }))).toBe(1);
    expect(await delta(ctx, () => updateWorkspaceSettings(ctx, {}))).toBe(0);
  });
});

describe('saved views: only shared ones bump', () => {
  const view = { projectId: null, layout: 'list' as const, filter: {} };

  it('a private view is invisible to others', async () => {
    const { ctx } = await setup();
    let id = '';
    expect(await delta(ctx, async () => {
      const r = await createView(ctx, { ...view, name: 'Mine' });
      if (r.ok) id = r.data.id;
      return r;
    })).toBe(0);
    expect(await delta(ctx, () => updateView(ctx, { id, name: 'Still mine' }))).toBe(0);
    expect(await delta(ctx, () => deleteView(ctx, { id }))).toBe(0);
  });

  it('sharing, editing a shared view and deleting it bump', async () => {
    const { ctx } = await setup();
    const made = await createView(ctx, { ...view, name: 'Team' });
    if (!made.ok) throw new Error(made.error);
    const id = made.data.id;
    expect(await delta(ctx, () => updateView(ctx, { id, shared: true }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, name: 'Team board' }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, shared: false }))).toBe(1);
    expect(await delta(ctx, () => updateView(ctx, { id, shared: true }))).toBe(1);
    expect(await delta(ctx, () => deleteView(ctx, { id }))).toBe(1);
  });

  it('creating a shared view bumps; duplicating one makes a private copy that does not', async () => {
    const { ctx } = await setup();
    let id = '';
    expect(await delta(ctx, async () => {
      const r = await createView(ctx, { ...view, name: 'Team', shared: true });
      if (r.ok) id = r.data.id;
      return r;
    })).toBe(1);
    expect(await delta(ctx, () => duplicateView(ctx, { id }))).toBe(0);
  });
});
```

In `tests/server/reminder-run.test.ts`, add the import `import { getWorkspaceVersion } from '@/server/changes/queries';` and append inside `describe('runReminders', ...)`:

```ts
  it('bumps the workspace counter when it claims something, not on an empty rerun', async () => {
    const { ctx } = await setup();
    const { send } = recorder();

    const before = await getWorkspaceVersion(ctx);
    await runReminders({ now: NOW, send, gapMs: 0 });
    const afterFirst = await getWorkspaceVersion(ctx);
    expect(afterFirst).toBe(before + 1);

    await runReminders({ now: NOW, send, gapMs: 0 });
    expect(await getWorkspaceVersion(ctx)).toBe(afterFirst);
  });
```

In `tests/server/account-deletion.test.ts`, add the import `import { getWorkspaceVersion } from '@/server/changes/queries';` and append inside `describe('account deletion', ...)`:

```ts
  it('bumps the counter of every workspace the user shares', async () => {
    const owner = await createUser('d-live-1@example.com');
    const leaver = await createUser('d-live-2@example.com');
    const ws = await createWorkspace(owner.id, 'Shared', 'ws-live');
    await joinWorkspace(leaver.id, ws.id, 'member');
    const ctx = ctxFor(owner.id, ws.id, 'ws-live');

    const before = await getWorkspaceVersion(ctx);
    await deleteUser(leaver.id);
    expect(await getWorkspaceVersion(ctx)).toBe(before + 1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/changes.test.ts tests/server/reminder-run.test.ts tests/server/account-deletion.test.ts`
Expected: FAIL in the member / settings / shared-view / cron / deletion bump tests; private-view and duplicate tests already pass.

- [ ] **Step 3: Emit from `src/server/members/service.ts`**

Add the import: `import { emitChange, emitChangeFor } from '@/server/changes/service';`

`inviteMember` — the invite is only kept once the email went out, so emit just before the success return:

```ts
    await emitChange(ctx, {}, db);
    return ok({ invitationId: id });
```

`removeMember` — inside the transaction, after the delete:

```ts
      await tx
        .delete(member)
        .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, input.userId)));
      await emitChange(ctx, {}, tx);

      return ok(null);
```

`changeMemberRole` — inside the transaction, after the update:

```ts
      await emitChange(ctx, {}, tx);

      return ok(null);
```

`acceptInvitation` — inside the transaction, just before `return true;`:

```ts
      await emitChangeFor(invite.organizationId, tx);
      return true;
```

`declineInvitation` — replace the update statement with:

```ts
    const [declined] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(invitation)
        .set({ status: 'rejected' })
        .where(and(eq(invitation.id, found.data.id), eq(invitation.status, 'pending')))
        .returning({ id: invitation.id });
      if (rows.length > 0) await emitChangeFor(found.data.organizationId, tx);
      return rows;
    });
```

- [ ] **Step 4: Emit from `src/server/settings/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';` and replace the update statement with:

```ts
    await db.transaction(async (tx) => {
      await tx
        .update(workspaceSettings).set(patch)
        .where(eq(workspaceSettings.workspaceId, ctx.workspaceId));
      await emitChange(ctx, {}, tx);
    });
```

- [ ] **Step 5: Emit from `src/server/views/service.ts`**

Add the import: `import { emitChange } from '@/server/changes/service';`

`createView` — replace the insert with:

```ts
  const id = newId();
  const shared = parsed.data.shared ?? false;
  await db.transaction(async (tx) => {
    await tx.insert(savedView).values({
      id,
      workspaceId: ctx.workspaceId,
      projectId,
      ownerId: ctx.userId,
      name,
      shared,
      layout,
      filter,
      sort: cleanSort(layout, input.sort),
    });
    // A private view is nobody else's business.
    if (shared) await emitChange(ctx, { projectId }, tx);
  });
  return ok({ id });
```

`editable` — return what the emit rule needs:

```ts
async function editable(
  ctx: WorkspaceContext,
  id: string,
): Promise<Result<{ layout: ViewLayout; shared: boolean; projectId: string | null }>> {
  const view = await getView(ctx, id);
  if (!view) return err('View not found.');
  if (!canEditView(ctx, view)) return err('Only the owner or a workspace admin can change this view.');
  return ok({ layout: view.layout, shared: view.shared, projectId: view.projectId });
}
```

`updateView` — replace the final update with:

```ts
  await db.transaction(async (tx) => {
    await tx.update(savedView).set(patch)
      .where(and(eq(savedView.id, parsed.data.id), eq(savedView.workspaceId, ctx.workspaceId)));
    // Shared before or after: others either saw it or now will.
    if (target.data.shared || patch.shared === true) {
      await emitChange(ctx, { projectId: target.data.projectId }, tx);
    }
  });
  return ok(null);
```

`deleteView` — replace the delete with:

```ts
  await db.transaction(async (tx) => {
    await tx.delete(savedView)
      .where(and(eq(savedView.id, input.id), eq(savedView.workspaceId, ctx.workspaceId)));
    if (target.data.shared) await emitChange(ctx, { projectId: target.data.projectId }, tx);
  });
  return ok(null);
```

`duplicateView` — unchanged: it creates a private copy, which `createView` does not announce.

- [ ] **Step 6: Emit from the reminders cron** — in `src/server/reminders/run.ts`, add `import { db } from '@/db';` (if not already imported) and `import { emitChangeFor } from '@/server/changes/service';`, then after `const claimed = await claimNotifications(drafts);`:

```ts
  // Recipients' bells live in the workspace layout, so tell those pages. A
  // workspace whose drafts were all repeats gets a harmless extra refresh.
  if (claimed > 0) {
    for (const workspaceId of new Set(drafts.map((d) => d.workspaceId))) {
      await emitChangeFor(workspaceId, db);
    }
  }
```

- [ ] **Step 7: Emit from account deletion** — in `src/server/account/deletion.ts`, add `import { emitChangeFor } from '@/server/changes/service';`, then inside `prepareAccountDeletion`'s transaction, right after the `stuck` check:

```ts
    if (stuck.length > 0) throw blocked(stuck);

    // Workspaces that keep going lose a member and show "Deleted user" from now on.
    for (const r of rows) if (!r.solo) await emitChangeFor(r.id, tx);
```

- [ ] **Step 8: Run the new tests and the suites they touch**

Run: `yarn vitest run tests/server/changes.test.ts tests/server/reminder-run.test.ts tests/server/account-deletion.test.ts tests/server/members.test.ts tests/server/views.test.ts tests/server/workspaces.test.ts`
Expected: PASS.

- [ ] **Step 9: Full vitest run**

Run: `yarn test`
Expected: PASS (previous 715 + the new ones).

- [ ] **Step 10: Typecheck, update graph, commit**

```bash
yarn typecheck && graphify update .
git add src/server/members/service.ts src/server/settings/service.ts src/server/views/service.ts src/server/reminders/run.ts src/server/account/deletion.ts tests/server/changes.test.ts tests/server/reminder-run.test.ts tests/server/account-deletion.test.ts
git commit -m "feat(live): member, settings, shared view, cron and deletion writes bump the change counter"
```

---

### Task 5: Poll endpoint

**Files:**
- Create: `src/app/api/workspaces/[slug]/changes/route.ts`, `tests/unit/changes-route.test.ts`
- Modify: `src/lib/request-tracker.ts`, `tests/unit/request-tracker.test.ts`

**Interfaces:**
- Consumes: `pollWorkspaceVersion(userId, slug)` (Task 1).
- Produces: `GET /api/workspaces/[slug]/changes` → `200 { version: number }` | `401` | `404`, all `Cache-Control: private, no-store`; `LIVE_POLL_HEADER = 'x-live-poll'` exported from `@/lib/request-tracker`.

- [ ] **Step 1: Read the route-handler doc** — `ls node_modules/next/dist/docs/` and read the route handler guide; confirm `params` is a Promise and `Response.json` is available.

- [ ] **Step 2: Write the failing tests** — create `tests/unit/changes-route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/changes/queries', () => ({ pollWorkspaceVersion: vi.fn() }));

const { GET } = await import('@/app/api/workspaces/[slug]/changes/route');
const { auth } = await import('@/lib/auth');
const { pollWorkspaceVersion } = await import('@/server/changes/queries');

const getSession = vi.mocked(auth.api.getSession);
const poll = vi.mocked(pollWorkspaceVersion);

afterEach(() => vi.clearAllMocks());

const call = (slug = 'acme') =>
  GET(new Request(`http://localhost/api/workspaces/${slug}/changes`) as never, { params: Promise.resolve({ slug }) });

describe('GET /api/workspaces/[slug]/changes', () => {
  it('401s without a session and reads nothing', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(poll).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('404s for a non-member or unknown slug', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    poll.mockResolvedValue(null);
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(poll).toHaveBeenCalledWith('u1', 'nope');
  });

  it('answers a member with the version, never cached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    poll.mockResolvedValue(7);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 7 });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
```

In `tests/unit/request-tracker.test.ts`, import `LIVE_POLL_HEADER` alongside the others and add inside `describe('shouldTrackRequest', ...)`:

```ts
  it('skips the live-refresh poll, so the bar does not flash every 30 seconds', () => {
    expect(shouldTrackRequest('/api/workspaces/acme/changes', { headers: { [LIVE_POLL_HEADER]: '1' } }, origin)).toBe(false);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run tests/unit/changes-route.test.ts tests/unit/request-tracker.test.ts`
Expected: FAIL — route module not found; `LIVE_POLL_HEADER` undefined.

- [ ] **Step 4: Skip the poll in the request tracker** — in `src/lib/request-tracker.ts`, replace the `PREFETCH_HEADERS` block with:

```ts
/** Sent by the live-refresh poll (src/lib/live/transport.ts). */
export const LIVE_POLL_HEADER = 'x-live-poll';

// Next.js router prefetches run in the background on hover/viewport and never
// block the user, so they must not flash the bar. Neither must the live-refresh
// poll, which also must not count as the user's own request in flight.
const UNTRACKED_HEADERS = ['next-router-prefetch', 'next-router-segment-prefetch', LIVE_POLL_HEADER];
```

and in `shouldTrackRequest` change `PREFETCH_HEADERS.some(...)` to `UNTRACKED_HEADERS.some(...)`.

- [ ] **Step 5: Write the route** — create `src/app/api/workspaces/[slug]/changes/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { pollWorkspaceVersion } from '@/server/changes/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The live-refresh poll (src/lib/live/transport.ts): the workspace's change
 * counter, for members only. A non-member and an unknown slug get the same 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401, headers: NO_STORE });

  const { slug } = await params;
  const version = await pollWorkspaceVersion(session.user.id, slug);
  if (version === null) return new Response('Not found', { status: 404, headers: NO_STORE });

  return Response.json({ version }, { headers: NO_STORE });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run tests/unit/changes-route.test.ts tests/unit/request-tracker.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, update graph, commit**

```bash
yarn typecheck && yarn lint && graphify update .
git add src/app/api/workspaces src/lib/request-tracker.ts tests/unit/changes-route.test.ts tests/unit/request-tracker.test.ts
git commit -m "feat(live): poll endpoint for the workspace change counter"
```

---

### Task 6: Client logic — transport, busy detection, refresher

**Files:**
- Create: `src/lib/live/transport.ts`, `src/lib/live/busy.ts`, `src/lib/live/use-drag-busy.ts`, `src/lib/live/refresher.ts`, `tests/unit/live-transport.test.ts`, `tests/unit/live-busy.test.ts`, `tests/unit/live-refresher.test.ts`

**Interfaces:**
- Consumes: `LIVE_POLL_HEADER`, `getPendingRequests`, `subscribeToRequests` from `@/lib/request-tracker` (Task 5).
- Produces:
  - `type ChangeTransport = { subscribe(onVersion: (version: number) => void): () => void }`
  - `createPollingTransport(slug: string, options?: PollingOptions): ChangeTransport`
  - `markBusy(key: string): void`, `releaseBusy(key: string): void`, `isTextEntry(el: Element | null): boolean`, `isBusy(): boolean`, `subscribeBusy(listener: () => void): () => void`
  - `useDragBusy(key: string): { start: () => void; end: () => void }`
  - `type Refresher = { onVersion(v: number): void; setSeen(v: number): void; recheck(): void }`, `createRefresher(opts: { seen: number; isBusy: () => boolean; refresh: () => void }): Refresher`

- [ ] **Step 1: Write the failing transport tests** — create `tests/unit/live-transport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_POLL_HEADER } from '@/lib/request-tracker';
import { createPollingTransport } from '@/lib/live/transport';

type Doc = EventTarget & { visibilityState: DocumentVisibilityState };

let doc: Doc;
let win: EventTarget;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const json = (version: number) => new Response(JSON.stringify({ version }), { status: 200 });

function start(onVersion = vi.fn()) {
  const stop = createPollingTransport('acme', {
    fetch: fetchMock as never, doc: doc as never, win: win as never,
  }).subscribe(onVersion);
  return { onVersion, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  win = new EventTarget();
  fetchMock = vi.fn<typeof fetch>(async () => json(3));
});
afterEach(() => vi.useRealTimers());

describe('createPollingTransport', () => {
  it('polls every 30 s with the poll header and reports the version', async () => {
    const { onVersion, stop } = start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/acme/changes');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ [LIVE_POLL_HEADER]: '1' });
    expect(onVersion).toHaveBeenCalledWith(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not poll while hidden, and checks at once when visible again', async () => {
    const { stop } = start();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('checks at once on window focus', async () => {
    const { stop } = start();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('backs off to 2 min after 5 min without input, and returns to 30 s on input', async () => {
    const { stop } = start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(11);

    win.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    stop();
  });

  it.each([401, 404])('stops for good on %i (signed out or removed)', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    const { onVersion } = start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onVersion).not.toHaveBeenCalled();
  });

  it('ignores network errors and server errors, and tries again next tick', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const { onVersion, stop } = start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onVersion).toHaveBeenCalledWith(3);
    stop();
  });

  it('stops polling and listening when unsubscribed', async () => {
    const { stop } = start();
    stop();
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing busy tests** — create `tests/unit/live-busy.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const pending = { n: 0 };
const requestListeners = new Set<() => void>();
vi.mock('@/lib/request-tracker', () => ({
  getPendingRequests: () => pending.n,
  subscribeToRequests: (l: () => void) => {
    requestListeners.add(l);
    return () => requestListeners.delete(l);
  },
}));

const { isBusy, isTextEntry, markBusy, releaseBusy, subscribeBusy } = await import('@/lib/live/busy');

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
  pending.n = 0;
  releaseBusy('drag');
});

describe('isTextEntry', () => {
  it('counts text inputs, textareas and contenteditable', () => {
    expect(isTextEntry(mount('<input type="text">'))).toBe(true);
    expect(isTextEntry(mount('<input>'))).toBe(true);
    expect(isTextEntry(mount('<textarea></textarea>'))).toBe(true);
    expect(isTextEntry(mount('<div contenteditable="true"><p>x</p></div>'))).toBe(true);
    const inner = mount('<div contenteditable="true"><p>x</p></div>').querySelector('p');
    expect(isTextEntry(inner)).toBe(true);
  });

  it('a checkbox, a button or nothing is not typing', () => {
    expect(isTextEntry(mount('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(mount('<button>Board</button>'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('isBusy', () => {
  it('while a drag is held', () => {
    expect(isBusy()).toBe(false);
    markBusy('drag');
    expect(isBusy()).toBe(true);
    releaseBusy('drag');
    expect(isBusy()).toBe(false);
  });

  it('while a text field has focus, not a checkbox', () => {
    mount('<input type="text">').focus();
    expect(isBusy()).toBe(true);
    mount('<input type="checkbox">').focus();
    expect(isBusy()).toBe(false);
  });

  it('while one of my requests is in flight', () => {
    pending.n = 1;
    expect(isBusy()).toBe(true);
  });
});

describe('subscribeBusy', () => {
  it('fires on drag changes, request settles and (a tick later) focus changes', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const stop = subscribeBusy(listener);

    markBusy('drag');
    expect(listener).toHaveBeenCalledTimes(1);

    for (const l of requestListeners) l();
    expect(listener).toHaveBeenCalledTimes(2);

    const input = mount('<input type="text">');
    input.focus();
    input.blur();
    expect(listener).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(4);

    stop();
    releaseBusy('drag');
    expect(listener).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Write the failing refresher tests** — create `tests/unit/live-refresher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRefresher } from '@/lib/live/refresher';

function make(seen = 5) {
  const state = { busy: false };
  const refresh = vi.fn();
  const r = createRefresher({ seen, isBusy: () => state.busy, refresh });
  return { r, state, refresh };
}

describe('createRefresher', () => {
  it('does nothing when the polled version is the one on screen', () => {
    const { r, refresh } = make(5);
    r.onVersion(5);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when a newer version arrives and the page is idle', () => {
    const { r, refresh } = make(5);
    r.onVersion(6);
    r.onVersion(6);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('defers while busy and collapses several changes into one refresh', () => {
    const { r, state, refresh } = make(5);
    state.busy = true;
    r.onVersion(6);
    r.onVersion(7);
    r.onVersion(8);
    r.recheck();
    expect(refresh).not.toHaveBeenCalled();

    state.busy = false;
    r.recheck();
    r.recheck();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when my own edit already brought the page up to date', () => {
    const { r, state, refresh } = make(5);
    state.busy = true; // my save is in flight; the poll already sees its bump
    r.onVersion(6);
    r.setSeen(6); // the save's response re-rendered the layout with version 6
    state.busy = false;
    r.recheck();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes again for a later change', () => {
    const { r, refresh } = make(5);
    r.onVersion(6);
    r.setSeen(6);
    r.onVersion(7);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores an older version arriving late', () => {
    const { r, refresh } = make(5);
    r.setSeen(9);
    r.onVersion(8);
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `yarn vitest run tests/unit/live-transport.test.ts tests/unit/live-busy.test.ts tests/unit/live-refresher.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Write the transport** — create `src/lib/live/transport.ts`:

```ts
import { LIVE_POLL_HEADER } from '@/lib/request-tracker';

/**
 * Where change notices come from. Polling today; a Pusher transport later
 * implements the same shape and LiveRefresh picks one.
 */
export type ChangeTransport = {
  /** Calls onVersion with the workspace's change counter; returns unsubscribe. */
  subscribe(onVersion: (version: number) => void): () => void;
};

export type PollingOptions = {
  intervalMs?: number;
  /** No pointer or key input for this long counts as idle. */
  idleAfterMs?: number;
  idleIntervalMs?: number;
  fetch?: typeof fetch;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
};

const INPUT_EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Polls GET /api/workspaces/[slug]/changes while the tab is visible: every 30 s,
 * every 2 min once the user has been idle for 5 min, and at once when the tab
 * comes back. 401/404 (signed out, removed) stops it for good; anything else
 * that goes wrong waits for the next tick.
 */
export function createPollingTransport(slug: string, options: PollingOptions = {}): ChangeTransport {
  const { intervalMs = 30_000, idleAfterMs = 300_000, idleIntervalMs = 120_000 } = options;

  return {
    subscribe(onVersion) {
      // Through window each call, so the request tracker's wrapper (installed later) sees it.
      const doFetch: typeof fetch = options.fetch ?? ((input, init) => window.fetch(input, init));
      const doc = options.doc ?? document;
      const win = options.win ?? window;
      const url = `/api/workspaces/${encodeURIComponent(slug)}/changes`;

      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      let inFlight = false;
      let lastInput = Date.now();

      const idle = () => Date.now() - lastInput >= idleAfterMs;

      function schedule() {
        clearTimeout(timer);
        if (stopped || doc.visibilityState !== 'visible') return;
        timer = setTimeout(check, idle() ? idleIntervalMs : intervalMs);
      }

      async function check() {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const res = await doFetch(url, { headers: { [LIVE_POLL_HEADER]: '1' }, cache: 'no-store' });
          if (res.status === 401 || res.status === 404) {
            stop();
            return;
          }
          if (res.ok) {
            const body = (await res.json()) as { version?: unknown };
            if (typeof body.version === 'number') onVersion(body.version);
          }
        } catch {
          // Offline or mid-deploy: the next tick tries again.
        } finally {
          inFlight = false;
          schedule();
        }
      }

      const onVisibility = () => {
        if (doc.visibilityState === 'visible') void check();
        else clearTimeout(timer);
      };
      const onFocus = () => void check();
      const onInput = () => {
        const wasIdle = idle();
        lastInput = Date.now();
        // Back from idle: the 2-minute timer would be stale, so restart at 30 s.
        if (wasIdle) schedule();
      };

      function stop() {
        stopped = true;
        clearTimeout(timer);
        doc.removeEventListener('visibilitychange', onVisibility);
        win.removeEventListener('focus', onFocus);
        for (const type of INPUT_EVENTS) win.removeEventListener(type, onInput);
      }

      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('focus', onFocus);
      for (const type of INPUT_EVENTS) win.addEventListener(type, onInput);
      schedule();

      return stop;
    },
  };
}
```

- [ ] **Step 6: Write busy detection** — create `src/lib/live/busy.ts`:

```ts
import { getPendingRequests, subscribeToRequests } from '@/lib/request-tracker';

/**
 * Whether a live refresh would get in the user's way right now: mid-drag,
 * typing, or waiting on one of their own requests. LiveRefresh holds a pending
 * refresh until this turns false.
 */

const held = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called on drag start; `key` names the drag surface. */
export function markBusy(key: string): void {
  held.add(key);
  emit();
}

export function releaseBusy(key: string): void {
  if (held.delete(key)) emit();
}

// Inputs that take a click, not typing: focus left on one must not hold refreshes.
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NOT_TEXT.has((el as HTMLInputElement).type);
  // closest(), not isContentEditable: the caret sits in a child of the editor root.
  return el.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}

export function isBusy(): boolean {
  return held.size > 0 || isTextEntry(document.activeElement) || getPendingRequests() > 0;
}

/** Fires whenever isBusy() may have changed. */
export function subscribeBusy(listener: () => void): () => void {
  // focusout fires before focus lands anywhere new, so look on the next task.
  const later = () => {
    setTimeout(listener, 0);
  };
  listeners.add(listener);
  document.addEventListener('focusin', later);
  document.addEventListener('focusout', later);
  const unsubscribeRequests = subscribeToRequests(listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('focusin', later);
    document.removeEventListener('focusout', later);
    unsubscribeRequests();
  };
}
```

- [ ] **Step 7: Write the drag hook** — create `src/lib/live/use-drag-busy.ts`:

```ts
import { useEffect, useMemo } from 'react';
import { markBusy, releaseBusy } from './busy';

/**
 * Handlers for a DndContext: live refreshes wait while a drag is in progress.
 * Released on unmount too, so navigating away mid-drag cannot leave refreshes
 * blocked.
 */
export function useDragBusy(key: string): { start: () => void; end: () => void } {
  useEffect(() => () => releaseBusy(key), [key]);
  return useMemo(() => ({ start: () => markBusy(key), end: () => releaseBusy(key) }), [key]);
}
```

- [ ] **Step 8: Write the refresher** — create `src/lib/live/refresher.ts`:

```ts
/**
 * The decision LiveRefresh makes on every poll answer and every busy change:
 * refresh only when the server is ahead of what is on screen, and only when the
 * user is idle. Pure, so it is tested without React.
 */
export type Refresher = {
  /** A version from the transport. */
  onVersion(version: number): void;
  /** The version the server rendered into the page (the layout prop). */
  setSeen(version: number): void;
  /** Busy state may have changed. */
  recheck(): void;
};

export function createRefresher({
  seen,
  isBusy,
  refresh,
}: {
  seen: number;
  isBusy: () => boolean;
  refresh: () => void;
}): Refresher {
  let onScreen = seen;
  let latest = seen;

  function flush() {
    if (latest <= onScreen || isBusy()) return;
    // Counted as on screen now, so the refresh's own request (and polls that
    // land during it) do not start a second one.
    onScreen = latest;
    refresh();
  }

  return {
    onVersion(version) {
      if (version > latest) latest = version;
      flush();
    },
    setSeen(version) {
      if (version > onScreen) onScreen = version;
      if (version > latest) latest = version;
    },
    recheck: flush,
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `yarn vitest run tests/unit/live-transport.test.ts tests/unit/live-busy.test.ts tests/unit/live-refresher.test.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck, lint, update graph, commit**

```bash
yarn typecheck && yarn lint && graphify update .
git add src/lib/live tests/unit/live-transport.test.ts tests/unit/live-busy.test.ts tests/unit/live-refresher.test.ts
git commit -m "feat(live): polling transport, busy detection and refresh decision"
```

---

### Task 7: Wire it into the app, mark drags busy, e2e, docs

**Files:**
- Create: `src/components/shell/LiveRefresh.tsx`, `tests/e2e/live-refresh.spec.ts`
- Modify: `src/app/(app)/[workspaceSlug]/layout.tsx`, `src/components/board/Board.tsx`, `src/components/calendar/CalendarMonth.tsx`, `src/components/board/ManageColumnsDialog.tsx`, `src/components/task/TaskTableSettings.tsx`, `docs/superpowers/specs/2026-10-04-live-refresh-design.md`, `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`

**Interfaces:**
- Consumes: `getWorkspaceVersion` (Task 1); `createPollingTransport`, `isBusy`, `subscribeBusy`, `useDragBusy`, `createRefresher`, `Refresher` (Task 6).
- Produces: `<LiveRefresh slug={string} version={number} />` client component.

- [ ] **Step 1: Write the failing e2e** — create `tests/e2e/live-refresh.spec.ts`:

```ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import { createTask } from './tasks';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await expect(page).toHaveURL(/\/new-workspace/);
}

/** Straight into the workspace; invite.spec.ts covers the real invitation flow. */
async function addMember(slug: string, email: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO member (id, organization_id, user_id, role)
       SELECT $3, o.id, u.id, 'member' FROM organization o, "user" u WHERE o.slug = $1 AND u.email = $2`,
      [slug, email, `m-${stamp()}`],
    );
  } finally {
    await client.end();
  }
}

/** Ada (owner, `page`) and Bob (member, own browser context) on the same project. */
async function twoMembers(page: Page, browser: Browser) {
  const s = stamp();
  await signUp(page, 'Ada', `ada-${s}@example.com`);
  await page.getByLabel('Workspace name').fill(`Live ${s}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\//);
  const projectUrl = page.url();
  const slug = new URL(projectUrl).pathname.split('/')[1];

  const bobEmail = `bob-${s}@example.com`;
  const bob = await (await browser.newContext()).newPage();
  await signUp(bob, 'Bob', bobEmail);
  await addMember(slug, bobEmail);
  await bob.goto(projectUrl);
  return { bob };
}

/** What the browser does when Ada comes back to the tab; skips the 30 s wait. */
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test("a teammate's new task shows up without a reload", async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);

  await createTask(bob, 'From Bob');
  await expect(bob.getByText('From Bob')).toBeVisible();
  await expect(page.getByText('From Bob')).toHaveCount(0);

  await refocus(page);
  await expect(page.getByText('From Bob')).toBeVisible();
});

test('a refresh waits while I type, then lands with my draft intact', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Shared');
  // The project opens on the board; the card's button is named by its title.
  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(page).toHaveURL(/[?&]task=/);
  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByLabel('Comment').pressSequentially('Half a thought');

  await createTask(bob, 'From Bob');
  await refocus(page);
  // The poll has answered, but the composer still has focus.
  await page.waitForTimeout(1500);
  await expect(page.getByText('From Bob')).toHaveCount(0);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.getByText('From Bob')).toHaveCount(1);
  await expect(page.getByLabel('Comment')).toContainText('Half a thought');
});
```

- [ ] **Step 2: Run the e2e to verify it fails**

The user keeps `next dev` on :3000 and Playwright reuses it, so run against a fresh build on :3100 (memory note: temp config + `BETTER_AUTH_URL`). Create a scratch config outside the repo:

```bash
cat > /tmp/claude-1000/-home-levon-taskeeper/6369609f-237a-4734-a007-7e6b08936b7a/scratchpad/pw-3100.config.ts <<'EOF'
import base from '/home/levon/taskeeper/playwright.config';
export default {
  ...base,
  testDir: '/home/levon/taskeeper/tests/e2e',
  use: { ...base.use, baseURL: 'http://localhost:3100' },
  webServer: {
    ...base.webServer,
    command: 'yarn build && yarn start -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: { ...(base.webServer as { env: Record<string, string> }).env, BETTER_AUTH_URL: 'http://localhost:3100' },
  },
};
EOF
yarn playwright test -c /tmp/claude-1000/-home-levon-taskeeper/6369609f-237a-4734-a007-7e6b08936b7a/scratchpad/pw-3100.config.ts live-refresh
```

Expected: FAIL — "From Bob" never appears on Ada's page (nothing polls yet).

- [ ] **Step 3: Write `<LiveRefresh>`** — create `src/components/shell/LiveRefresh.tsx`:

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isBusy, subscribeBusy } from '@/lib/live/busy';
import { createRefresher, type Refresher } from '@/lib/live/refresher';
import { createPollingTransport } from '@/lib/live/transport';

/**
 * Keeps workspace pages current while teammates edit: when the workspace's
 * change counter passes `version` (what this render was built from), refresh
 * the server components once the user is idle. Renders nothing. The private
 * Todo page opts out: only its owner edits it.
 */
export function LiveRefresh({ slug, version }: { slug: string; version: number }) {
  const router = useRouter();
  const paused = usePathname().endsWith('/todo');
  const seen = useRef(version);
  const refresher = useRef<Refresher | null>(null);

  useEffect(() => {
    seen.current = version;
    refresher.current?.setSeen(version);
  }, [version]);

  useEffect(() => {
    if (paused) return;
    const r = createRefresher({ seen: seen.current, isBusy, refresh: () => router.refresh() });
    refresher.current = r;
    const unsubscribeBusy = subscribeBusy(r.recheck);
    const unsubscribeChanges = createPollingTransport(slug).subscribe(r.onVersion);
    return () => {
      unsubscribeChanges();
      unsubscribeBusy();
      refresher.current = null;
    };
  }, [slug, paused, router]);

  return null;
}
```

- [ ] **Step 4: Mount it** — `src/app/(app)/[workspaceSlug]/layout.tsx` becomes:

```tsx
import { headers } from 'next/headers';
import { LiveRefresh } from '@/components/shell/LiveRefresh';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';
import { auth } from '@/lib/auth';
import { requireWorkspace, signInRedirect } from '@/lib/session';
import { getWorkspaceVersion } from '@/server/changes/queries';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();

  const ctx = await requireWorkspace(workspaceSlug);
  const version = await getWorkspaceVersion(ctx);

  return (
    <WorkspaceShell ctx={ctx}>
      <LiveRefresh slug={ctx.slug} version={version} />
      {children}
    </WorkspaceShell>
  );
}
```

(Mounted here rather than in `WorkspaceShell`: the shell is shared with account settings, which is outside the workspace.)

- [ ] **Step 5: Mark drags busy**

`src/components/board/Board.tsx` — add `import { useDragBusy } from '@/lib/live/use-drag-busy';`, declare `const drag = useDragBusy('board');` next to the other hooks at the top of the component, make `drag.end();` the first line of `onDragEnd`, and on `<KanbanProvider>`:

```tsx
        onDragStart={drag.start}
        onDataChange={setDragItems}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          drag.end();
          setDragItems(null);
        }}
```

`src/components/calendar/CalendarMonth.tsx` — add the import, declare `const drag = useDragBusy('calendar');` with the other hooks, make `drag.end();` the first line of `onDragEnd`, and on the `<DndContext id="calendar">`:

```tsx
        onDragStart={drag.start}
        onDragEnd={onDragEnd}
        onDragCancel={drag.end}
```

`src/components/board/ManageColumnsDialog.tsx` — add the import, declare `const drag = useDragBusy('columns');` next to `const [dragging, setDragging] = useState(false);`, make `drag.end();` the first line of `onDragEnd` (before `setDragging(false);`), and on its `<DndContext>`:

```tsx
            onDragStart={() => {
              drag.start();
              setDragging(true);
            }}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              drag.end();
              setDragging(false);
            }}
```

`src/components/task/TaskTableSettings.tsx` — same as ManageColumnsDialog with key `'table-columns'`.

- [ ] **Step 6: Run the e2e to verify it passes**

Run: `yarn playwright test -c /tmp/claude-1000/-home-levon-taskeeper/6369609f-237a-4734-a007-7e6b08936b7a/scratchpad/pw-3100.config.ts live-refresh`
Expected: PASS (2 tests).

- [ ] **Step 7: Full verification**

Run: `yarn typecheck && yarn lint && yarn test && yarn playwright test -c /tmp/claude-1000/-home-levon-taskeeper/6369609f-237a-4734-a007-7e6b08936b7a/scratchpad/pw-3100.config.ts`
Expected: all green — vitest count up from 715, e2e up from 47 to 49. In particular `board-drag`, `calendar`, `comments`, `list-bulk` and `views` specs must still pass (refreshes must not disturb them).

- [ ] **Step 8: Bring the spec in line with what was built** — in `docs/superpowers/specs/2026-10-04-live-refresh-design.md`:
  - "### `<LiveRefresh>`": replace "passes it to `WorkspaceShell`, which mounts" with "mounts `<LiveRefresh slug={…} version={…} />` itself, next to `{children}` (not in `WorkspaceShell`, which account settings shares)".
  - "### Who emits", views bullet: replace "`createView`, `updateView`, `duplicateView`, `deleteView`" with "`createView`, `updateView`, `deleteView` (`duplicateView` makes a private copy and never emits)".
  - "### Transport": delete the bullet about `NEXT_PUBLIC_LIVE_POLL_MS`; replace with "Interval and idle thresholds are options, for unit tests."
  - "## Poll endpoint": replace "One indexed read (membership + `workspace_change`)" with "One query: `organization` ⋈ `member` ⟕ `workspace_change` by slug".
  - "## Testing", e2e bullet: replace "`NEXT_PUBLIC_LIVE_POLL_MS=1000`" with "a dispatched window `focus` event instead of waiting 30 s".

- [ ] **Step 9: Update the roadmap** — in `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`, replace item 11's text with:

```markdown
11. Slice 8: realtime sync — built as polling (2026-10-04, `feat/live-refresh`): a
    per-workspace change counter bumped in every shared write's transaction, polled every
    30 s while visible. Pusher later = a second `ChangeTransport` plus a publish in
    `emitChange`; spec `docs/superpowers/specs/2026-10-04-live-refresh-design.md`.
```

- [ ] **Step 10: Update graph, commit**

```bash
graphify update .
git add src/components/shell/LiveRefresh.tsx "src/app/(app)/[workspaceSlug]/layout.tsx" src/components/board/Board.tsx src/components/calendar/CalendarMonth.tsx src/components/board/ManageColumnsDialog.tsx src/components/task/TaskTableSettings.tsx tests/e2e/live-refresh.spec.ts docs/superpowers/specs/2026-10-04-live-refresh-design.md docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md
git commit -m "feat(live): refresh workspace pages when teammates change shared data"
```

---

## Deploy note (for the PR body, when the user asks for one)

Run `yarn db:setup:prod` / `yarn db:setup:dev` **before** deploying: every shared write now upserts `workspace_change` inside its transaction, so a missing table fails every edit.
