# Comments and Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task a chronological feed that mixes member comments with an automatic record of what changed, who changed it, and when.

**Architecture:** Two additive tables — `comment` and `task_activity` — both cascading off `task`. Activity rows are written by the existing task service inside the same transaction as the mutation that caused them, and they store *display text* (a status name, a member name), not ids, so history still reads correctly after a column or member is gone. One query merges both tables into a single ordered feed; the task detail dialog renders it under the subtask section.

**Tech Stack:** Next.js 16.3.5 App Router, Drizzle 0.45.2 over `node-postgres`, Zod 4.6.5, Vitest, Playwright, Tailwind 4.3.3 + shadcn/ui, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-20-taskeeper-design.md` (§9 Deferred, first item; §3.2 schema conventions; §4 tenancy; §5 mutation contract)
**Roadmap:** `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md` (Slice 1 of 10)

## Global Constraints

Every constraint in `docs/superpowers/plans/2026-09-20-taskeeper-v1.md` applies unchanged. The ones this plan touches most:

- **Components never import from `src/db/`.** They import from `src/server/` only.
- **Every `src/server/**` exported function takes `ctx: WorkspaceContext` as its first parameter** and filters every query on `ctx.workspaceId`. A Drizzle transaction handle, where one is needed, is the *last* parameter and defaults to `db`.
- **Server Actions never throw across the boundary.** They return `Result<T>` and wrap their body in `withAction`.
- **Actor identity comes from `ctx.userId`, never from input.** Same reasoning as the denormalized `task.workspace_id` (spec §3.3).
- **Never compute "today" from the server clock.** Feed timestamps render through `formatInZone(instant, timezone)` from `src/lib/dates.ts`.
- **No raw hex colors in components.** Semantic Tailwind tokens only. **No emoji as icons** — Lucide SVG only.
- **New tables must be added to the `TRUNCATE` list in `tests/setup/db.ts`.** A table missing there leaks rows between tests and the failure surfaces far from its cause.
- **TDD is mandatory.** Write the failing test, watch it fail, implement, watch it pass, commit.
- **Commit at the end of every task** with a Conventional Commits message. Never add `Co-Authored-By` trailers.
- **Exact dependency versions, Yarn 4 only.** This plan adds no dependencies.

## Review Focus

Five input classes the spec implies but does not name. Each has a test in the task that owns the code.

1. **A comment body that is only whitespace, or longer than the column should hold.** Trimmed to empty must be rejected with a message, and 10,000 characters is the ceiling. (Task 3)
2. **A task id from another workspace passed to any comment call.** Must return `Task not found.` and write nothing — the feed is a new hole in the tenancy boundary. (Task 3)
3. **A member deleting or editing a comment they did not write.** Edit is author-only; delete is author, owner, or admin. Anyone else gets a refusal and the row survives. (Task 3)
4. **A failed task update that has already recorded its activity.** Update and activity share one transaction; if the update rolls back, no activity row remains. (Task 2)
5. **A board column renamed or deleted after the move that referenced it.** The activity row stores the name as it was, so the feed still renders after the column is gone. (Task 2)

Plus one carried from spec §3.4: a feed timestamp at 21:00 UTC must render as the next day in `Asia/Yerevan`. (Task 4)

---

### Task 1: Schema and migration for `comment` and `task_activity`

**Files:**
- Create: `src/db/schema/activity.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `tests/setup/db.ts:10-16` (the `TRUNCATE` list)
- Create: `drizzle/0002_<generated-name>.sql` (produced by `yarn db:generate`, not hand-written)
- Test: `tests/server/schema.test.ts` (append two cases)

**Interfaces:**
- Consumes: `organization`, `user`, `task` from `src/db/schema/auth.ts` and `src/db/schema/task.ts`.
- Produces: `comment` and `taskActivity` Drizzle tables, re-exported from `@/db`. Columns: `comment(id, workspaceId, taskId, authorId, body, createdAt, editedAt)`; `taskActivity(id, workspaceId, taskId, actorId, kind, fromValue, toValue, createdAt)`.

- [x] **Step 1: Write the failing tests**

Append to `tests/server/schema.test.ts` (the file already has `seedProject()` and the `beforeEach(resetDb)` / `afterAll(closeDb)` pair at the top):

```ts
// add `comment, taskActivity` to the existing import from '@/db'
describe('comment and task_activity', () => {
  it('deletes a task\'s comments and activity with the task', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();
    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });
    await db.insert(comment).values({
      id: newId(), workspaceId, taskId, authorId: userId, body: 'First',
    });
    await db.insert(taskActivity).values({
      id: newId(), workspaceId, taskId, actorId: userId, kind: 'created', toValue: 'Ship v1',
    });

    await db.delete(task).where(sql`id = ${taskId}`);

    expect(await db.select().from(comment)).toHaveLength(0);
    expect(await db.select().from(taskActivity)).toHaveLength(0);
  });

  it('defaults edited_at to null and stamps created_at', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();
    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await db.insert(comment).values({
      id: newId(), workspaceId, taskId, authorId: userId, body: 'Looks good',
    });

    const [row] = await db.select().from(comment);
    expect(row.editedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `yarn db:up && yarn test tests/server/schema.test.ts`
Expected: FAIL — `comment` and `taskActivity` are not exported from `@/db`.

- [x] **Step 3: Write the schema module**

Create `src/db/schema/activity.ts`:

```ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { task } from './task';

export const comment = pgTable(
  'comment',
  {
    id: text('id').primaryKey(),
    // Denormalized like task.workspace_id (spec §3.3): the tenancy filter is one
    // predicate, never a join through task -> project.
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull().references(() => user.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Null until the author edits; the UI shows "(edited)" off this, so it is a
    // separate column rather than an updated_at that every write touches.
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('comment_task_created_idx').on(t.taskId, t.createdAt)],
);

export const taskActivity = pgTable(
  'task_activity',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull().references(() => user.id),
    // Plain text, not a pg enum: the kind list is owned by application code and
    // grows with features, and an enum would need a migration for each addition.
    // The reader validates against ACTIVITY_KINDS.
    kind: text('kind').notNull(),
    // Display text as it was at the time — a status name, a member name, a date
    // string — never an id. History must still read correctly after the column
    // or the member it names is gone.
    fromValue: text('from_value'),
    toValue: text('to_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_activity_task_created_idx').on(t.taskId, t.createdAt)],
);
```

- [x] **Step 4: Re-export it**

In `src/db/schema/index.ts`, add after the existing lines:

```ts
export * from './activity';
```

- [x] **Step 5: Add both tables to the test truncate list**

In `tests/setup/db.ts`, change the `TRUNCATE TABLE` list so it reads:

```ts
    TRUNCATE TABLE
      comment, task_activity,
      task_label, task, task_status, label, project,
      workspace_settings, invitation, member, organization,
      session, account, verification, "user"
    RESTART IDENTITY CASCADE
```

- [x] **Step 6: Generate and apply the migration**

Run: `yarn db:generate && yarn db:migrate`
Expected: a new `drizzle/0002_*.sql` creating both tables and both indexes. Read it before applying — it must contain only `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD CONSTRAINT`, no `DROP`.

- [x] **Step 7: Run the tests to verify they pass**

Run: `yarn test tests/server/schema.test.ts`
Expected: PASS, including the two new cases.

- [x] **Step 8: Commit**

```bash
git add src/db/schema/activity.ts src/db/schema/index.ts tests/setup/db.ts tests/server/schema.test.ts drizzle
git commit -m "feat: comment and task activity tables"
```

---

### Task 2: Activity recorder, wired into the task service

**Files:**
- Create: `src/server/activity/service.ts`
- Modify: `src/server/tasks/service.ts` (`loadOwnedTask`, `assertStatus`, `createTask`, `updateTask`, `moveTask`)
- Test: `tests/server/activity.test.ts`

**Interfaces:**
- Consumes: `taskActivity` from `@/db`; `WorkspaceContext` from `@/lib/session`; `newId` from `@/lib/ids`.
- Produces:
  - `ACTIVITY_KINDS: readonly ['created','title','status','priority','assignee','due_date']`
  - `type ActivityKind = (typeof ACTIVITY_KINDS)[number]`
  - `type Executor` — `db` or a Drizzle transaction handle
  - `recordActivity(ctx: WorkspaceContext, entry: { taskId: string; kind: ActivityKind; from?: string | null; to?: string | null }, tx?: Executor): Promise<void>`

- [x] **Step 1: Write the failing tests**

Create `tests/server/activity.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { taskActivity } from '@/db';
import { getProject } from '@/server/projects/queries';
import { createProject } from '@/server/projects/service';
import { deleteStatus, updateStatus } from '@/server/statuses/service';
import { createTask, moveTask, updateTask } from '@/server/tasks/service';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, created.data.id);
  return { ctx, user, projectId: created.data.id, statuses: detail!.statuses };
}

const rows = (taskId: string) =>
  db.select().from(taskActivity).where(eq(taskActivity.taskId, taskId)).orderBy(asc(taskActivity.createdAt));

describe('activity recording', () => {
  it('records creation with the title', async () => {
    const { ctx, projectId } = await setup('a1@example.com', 'ws-a1');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    const entries = await rows(created.data.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('created');
    expect(entries[0].toValue).toBe('Ship v1');
    expect(entries[0].actorId).toBe(ctx.userId);
  });

  it('records a rename with both the old and the new title', async () => {
    const { ctx, projectId } = await setup('a2@example.com', 'ws-a2');
    const created = await createTask(ctx, { projectId, title: 'Old' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, title: 'New' });

    const entries = await rows(created.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created', 'title']);
    expect(entries[1].fromValue).toBe('Old');
    expect(entries[1].toValue).toBe('New');
  });

  it('records a status change by column name, not id', async () => {
    const { ctx, projectId, statuses } = await setup('a3@example.com', 'ws-a3');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[1].id });

    const entries = await rows(created.data.id);
    expect(entries[1].kind).toBe('status');
    expect(entries[1].fromValue).toBe('Todo');
    expect(entries[1].toValue).toBe('In Progress');
  });

  // Review Focus 5.
  it('keeps the column name after the column is renamed and deleted', async () => {
    const { ctx, projectId, statuses } = await setup('a4@example.com', 'ws-a4');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[1].id });

    await updateStatus(ctx, { statusId: statuses[1].id, name: 'Doing' });
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[0].id });
    const removed = await deleteStatus(ctx, { statusId: statuses[1].id });
    expect(removed.ok).toBe(true);

    const entries = await rows(created.data.id);
    expect(entries[1].toValue).toBe('In Progress');
  });

  it('records assignment and unassignment by member name', async () => {
    const { ctx, projectId } = await setup('a5@example.com', 'ws-a5');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, assigneeId: ctx.userId });
    await updateTask(ctx, { taskId: created.data.id, assigneeId: null });

    const entries = await rows(created.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created', 'assignee', 'assignee']);
    expect(entries[1].toValue).toBe('Ada');
    expect(entries[2].fromValue).toBe('Ada');
    expect(entries[2].toValue).toBeNull();
  });

  it('does not record anything for a reorder inside the same column', async () => {
    const { ctx, projectId, statuses } = await setup('a6@example.com', 'ws-a6');
    const first = await createTask(ctx, { projectId, title: 'First' });
    const second = await createTask(ctx, { projectId, title: 'Second' });
    if (!first.ok || !second.ok) throw new Error('create failed');

    await moveTask(ctx, {
      taskId: second.data.id, statusId: statuses[0].id, beforeId: null, afterId: first.data.id,
    });

    const entries = await rows(second.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created']);
  });

  // Review Focus 4.
  it('writes no activity when the update is rejected', async () => {
    const a = await setup('a7@example.com', 'ws-a7');
    const b = await setup('b7@example.com', 'ws-b7');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    const result = await updateTask(a.ctx, {
      taskId: created.data.id, statusId: b.statuses[0].id,
    });

    expect(result.ok).toBe(false);
    expect((await rows(created.data.id)).map((e) => e.kind)).toEqual(['created']);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `yarn test tests/server/activity.test.ts`
Expected: FAIL — every case reports zero activity rows.

- [x] **Step 3: Write the recorder**

Create `src/server/activity/service.ts`:

```ts
import { db, taskActivity } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';

export const ACTIVITY_KINDS = [
  'created', 'title', 'status', 'priority', 'assignee', 'due_date',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * `db` or a transaction handle. Callers that mutate and record together pass the
 * transaction, so a rolled-back mutation cannot leave an activity row behind.
 */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordActivity(
  ctx: WorkspaceContext,
  entry: { taskId: string; kind: ActivityKind; from?: string | null; to?: string | null },
  tx: Executor = db,
): Promise<void> {
  await tx.insert(taskActivity).values({
    id: newId(),
    workspaceId: ctx.workspaceId,
    taskId: entry.taskId,
    // From the context, never the input.
    actorId: ctx.userId,
    kind: entry.kind,
    fromValue: entry.from ?? null,
    toValue: entry.to ?? null,
  });
}
```

- [x] **Step 4: Widen the task service's lookups**

In `src/server/tasks/service.ts`, add `taskStatus`-name and old-value columns so a diff can be computed. Replace `assertStatus`'s select list and `loadOwnedTask` entirely:

```ts
/** Confirms a status belongs to a project that belongs to this workspace. */
async function assertStatus(ctx: WorkspaceContext, statusId: string, projectId: string) {
  const [row] = await db
    .select({ id: taskStatus.id, isDone: taskStatus.isDone, name: taskStatus.name })
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
      completedAt: task.completedAt, title: task.title, priority: task.priority,
      assigneeId: task.assigneeId, dueDate: task.dueDate,
      statusName: taskStatus.name,
    })
    .from(task)
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Member names, for activity rows that must survive the member being removed. */
async function memberName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.name ?? null;
}
```

Extend the imports at the top of the file:

```ts
import { db, project, task, taskStatus, user } from '@/db';
import { recordActivity } from '@/server/activity/service';
```

- [x] **Step 5: Record creation**

In `createTask`, replace the bare `await db.insert(task).values({...})` with a transaction that also records:

```ts
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(task).values({
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
      await recordActivity(ctx, { taskId: id, kind: 'created', to: parsed.data.title }, tx);
    });

    return ok({ id });
```

- [x] **Step 6: Record updates**

In `updateTask`, after the existing `patch` is fully built (including the `statusId` branch) and before the write, build the diff, then write both inside one transaction. Replace the tail of the function:

```ts
    const entries: { kind: ActivityKind; from?: string | null; to?: string | null }[] = [];

    if (patch.title !== undefined && patch.title !== owned.title) {
      entries.push({ kind: 'title', from: owned.title, to: patch.title as string });
    }
    if (patch.priority !== undefined && patch.priority !== owned.priority) {
      entries.push({ kind: 'priority', from: owned.priority, to: patch.priority as string });
    }
    if (patch.dueDate !== undefined && patch.dueDate !== owned.dueDate) {
      entries.push({ kind: 'due_date', from: owned.dueDate, to: patch.dueDate as string | null });
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== owned.assigneeId) {
      entries.push({
        kind: 'assignee',
        from: await memberName(owned.assigneeId),
        to: await memberName(patch.assigneeId as string | null),
      });
    }
    if (patch.statusId !== undefined && patch.statusId !== owned.statusId) {
      entries.push({ kind: 'status', from: owned.statusName, to: newStatusName });
    }

    await db.transaction(async (tx) => {
      await tx.update(task).set(patch).where(eq(task.id, parsed.data.taskId));
      for (const entry of entries) {
        await recordActivity(ctx, { taskId: parsed.data.taskId, ...entry }, tx);
      }
    });

    return ok(null);
```

`newStatusName` is captured in the existing `statusId` branch — change it to:

```ts
    let newStatusName: string | null = null;
    if (parsed.data.statusId !== undefined) {
      const status = await assertStatus(ctx, parsed.data.statusId, owned.projectId);
      if (!status) return err('That column does not belong to this project.');
      patch.statusId = parsed.data.statusId;
      newStatusName = status.name;
      // completed_at follows the column's is_done flag in both directions.
      patch.completedAt = status.isDone ? (owned.completedAt ?? new Date()) : null;
    }
```

Add `ActivityKind` to the activity import:

```ts
import { recordActivity, type ActivityKind } from '@/server/activity/service';
```

- [x] **Step 7: Record board moves that cross a column**

In `moveTask`, replace the final `db.update(...)` with:

```ts
    const crossedColumn = parsed.data.statusId !== owned.statusId;

    await db.transaction(async (tx) => {
      await tx
        .update(task)
        .set({
          statusId: parsed.data.statusId,
          position,
          completedAt: status.isDone ? (owned.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(task.id, parsed.data.taskId));

      // A reorder inside one column is not history — recording it would bury the
      // feed under every drag.
      if (crossedColumn) {
        await recordActivity(
          ctx,
          { taskId: parsed.data.taskId, kind: 'status', from: owned.statusName, to: status.name },
          tx,
        );
      }
    });
```

- [x] **Step 8: Run the tests to verify they pass**

Run: `yarn test tests/server/activity.test.ts tests/server/tasks.test.ts tests/server/statuses.test.ts`
Expected: PASS. The existing task and status suites must stay green — they exercise the same functions.

- [x] **Step 9: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: clean.

- [x] **Step 10: Commit**

```bash
git add src/server/activity/service.ts src/server/tasks/service.ts tests/server/activity.test.ts
git commit -m "feat: record task activity in the mutation transaction"
```

---

### Task 3: Comment service

**Files:**
- Create: `src/server/comments/service.ts`
- Test: `tests/server/comments.test.ts`

**Interfaces:**
- Consumes: `comment`, `task` from `@/db`; `Result`, `ok`, `err`, `withAction` from `@/lib/result`; `WorkspaceContext` from `@/lib/session`.
- Produces:
  - `createComment(ctx, input: { taskId: string; body: string }): Promise<Result<{ id: string }>>`
  - `updateComment(ctx, input: { commentId: string; body: string }): Promise<Result<null>>`
  - `deleteComment(ctx, input: { commentId: string }): Promise<Result<null>>`

- [x] **Step 1: Write the failing tests**

Create `tests/server/comments.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { comment } from '@/db';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { createComment, deleteComment, updateComment } from '@/server/comments/service';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const madeTask = await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });
  if (!madeTask.ok) throw new Error('setup failed');
  return { ctx, ws, projectId: created.data.id, taskId: madeTask.data.id };
}

/** A second member of the same workspace, with the given role. */
async function addMember(workspaceId: string, slug: string, email: string, role: 'admin' | 'member') {
  const user = await createUser(email, 'Grace');
  await joinWorkspace(user.id, workspaceId, role);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId, slug, role, timezone: 'Asia/Yerevan',
  };
  return ctx;
}

describe('createComment', () => {
  it('stores a comment authored by the caller', async () => {
    const { ctx, taskId } = await setup('c1@example.com', 'ws-c1');

    const result = await createComment(ctx, { taskId, body: '  Looks good  ' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(comment);
    expect(row.body).toBe('Looks good');
    expect(row.authorId).toBe(ctx.userId);
    expect(row.workspaceId).toBe(ctx.workspaceId);
    expect(row.editedAt).toBeNull();
  });

  // Review Focus 1.
  it('rejects a whitespace-only body', async () => {
    const { ctx, taskId } = await setup('c2@example.com', 'ws-c2');

    const result = await createComment(ctx, { taskId, body: '   \n  ' });

    expect(result).toEqual({ ok: false, error: 'Write something first.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  it('rejects a body over 10,000 characters', async () => {
    const { ctx, taskId } = await setup('c3@example.com', 'ws-c3');

    const result = await createComment(ctx, { taskId, body: 'x'.repeat(10_001) });

    expect(result).toEqual({ ok: false, error: 'That comment is too long.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  // Review Focus 2.
  it('refuses a task in another workspace', async () => {
    const a = await setup('c4a@example.com', 'ws-c4a');
    const b = await setup('c4b@example.com', 'ws-c4b');

    const result = await createComment(b.ctx, { taskId: a.taskId, body: 'Sneaky' });

    expect(result).toEqual({ ok: false, error: 'Task not found.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });
});

describe('updateComment', () => {
  it('lets the author edit and stamps edited_at', async () => {
    const { ctx, taskId } = await setup('c5@example.com', 'ws-c5');
    const created = await createComment(ctx, { taskId, body: 'Draft' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateComment(ctx, { commentId: created.data.id, body: 'Final' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(comment).where(eq(comment.id, created.data.id));
    expect(row.body).toBe('Final');
    expect(row.editedAt).toBeInstanceOf(Date);
  });

  // Review Focus 3.
  it('refuses an edit by anyone but the author, admins included', async () => {
    const { ctx, ws, taskId } = await setup('c6@example.com', 'ws-c6');
    const created = await createComment(ctx, { taskId, body: 'Mine' });
    if (!created.ok) throw new Error('setup failed');
    const admin = await addMember(ws.id, 'ws-c6', 'c6-admin@example.com', 'admin');

    const result = await updateComment(admin, { commentId: created.data.id, body: 'Yours' });

    expect(result).toEqual({ ok: false, error: 'You can only edit your own comments.' });
    const [row] = await db.select().from(comment).where(eq(comment.id, created.data.id));
    expect(row.body).toBe('Mine');
  });
});

describe('deleteComment', () => {
  it('lets the author delete', async () => {
    const { ctx, taskId } = await setup('c7@example.com', 'ws-c7');
    const created = await createComment(ctx, { taskId, body: 'Oops' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteComment(ctx, { commentId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  it('lets an admin delete someone else\'s comment', async () => {
    const { ctx, ws, taskId } = await setup('c8@example.com', 'ws-c8');
    const member = await addMember(ws.id, 'ws-c8', 'c8-member@example.com', 'member');
    const created = await createComment(member, { taskId, body: 'Spam' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteComment(ctx, { commentId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  // Review Focus 3.
  it('refuses a plain member deleting someone else\'s comment', async () => {
    const { ctx, ws, taskId } = await setup('c9@example.com', 'ws-c9');
    const created = await createComment(ctx, { taskId, body: 'Mine' });
    if (!created.ok) throw new Error('setup failed');
    const other = await addMember(ws.id, 'ws-c9', 'c9-member@example.com', 'member');

    const result = await deleteComment(other, { commentId: created.data.id });

    expect(result).toEqual({ ok: false, error: 'You can only delete your own comments.' });
    expect(await db.select().from(comment)).toHaveLength(1);
  });

  // Review Focus 2.
  it('refuses a comment id from another workspace', async () => {
    const a = await setup('c10a@example.com', 'ws-c10a');
    const b = await setup('c10b@example.com', 'ws-c10b');
    const created = await createComment(a.ctx, { taskId: a.taskId, body: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    const result = await deleteComment(b.ctx, { commentId: created.data.id });

    expect(result).toEqual({ ok: false, error: 'Comment not found.' });
    expect(await db.select().from(comment)).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `yarn test tests/server/comments.test.ts`
Expected: FAIL — `src/server/comments/service` does not exist.

- [x] **Step 3: Write the service**

Create `src/server/comments/service.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { comment, db, task } from '@/db';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

const bodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(10_000, 'That comment is too long.');

/** Loads a comment only if it belongs to this workspace. */
async function loadOwnedComment(ctx: WorkspaceContext, commentId: string) {
  const [row] = await db
    .select({ id: comment.id, authorId: comment.authorId, taskId: comment.taskId })
    .from(comment)
    .where(and(eq(comment.id, commentId), eq(comment.workspaceId, ctx.workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function createComment(
  ctx: WorkspaceContext,
  input: { taskId: string; body: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const parsed = z
      .object({ taskId: z.string().min(1), body: bodySchema })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const id = newId();
    await db.insert(comment).values({
      id,
      workspaceId: ctx.workspaceId,
      taskId: parsed.data.taskId,
      // From the context, never the input.
      authorId: ctx.userId,
      body: parsed.data.body,
    });

    return ok({ id });
  });
}

export async function updateComment(
  ctx: WorkspaceContext,
  input: { commentId: string; body: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z
      .object({ commentId: z.string().min(1), body: bodySchema })
      .safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);

    const owned = await loadOwnedComment(ctx, parsed.data.commentId);
    if (!owned) return err('Comment not found.');
    // Editing is author-only, admins included: an edited comment still carries
    // its author's name, so someone else's words must not change under it.
    if (owned.authorId !== ctx.userId) return err('You can only edit your own comments.');

    await db
      .update(comment)
      .set({ body: parsed.data.body, editedAt: new Date() })
      .where(eq(comment.id, parsed.data.commentId));

    return ok(null);
  });
}

export async function deleteComment(
  ctx: WorkspaceContext,
  input: { commentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const owned = await loadOwnedComment(ctx, input.commentId);
    if (!owned) return err('Comment not found.');

    // Unlike editing, deletion is also a moderation tool.
    const canModerate = ctx.role === 'owner' || ctx.role === 'admin';
    if (owned.authorId !== ctx.userId && !canModerate) {
      return err('You can only delete your own comments.');
    }

    await db.delete(comment).where(eq(comment.id, input.commentId));

    return ok(null);
  });
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `yarn test tests/server/comments.test.ts`
Expected: PASS, all eleven cases.

- [x] **Step 5: Commit**

```bash
git add src/server/comments/service.ts tests/server/comments.test.ts
git commit -m "feat: task comment service with author and moderator rules"
```

---

### Task 4: The merged feed query

**Files:**
- Create: `src/server/activity/queries.ts`
- Test: `tests/server/feed.test.ts`

**Interfaces:**
- Consumes: `comment`, `taskActivity`, `user` from `@/db`; `ActivityKind` from `@/server/activity/service`.
- Produces:
  - `type FeedEntry` — the discriminated union below
  - `listTaskFeed(ctx: WorkspaceContext, taskId: string): Promise<FeedEntry[]>`, oldest first

- [x] **Step 1: Write the failing tests**

Create `tests/server/feed.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { formatInZone } from '@/lib/dates';
import { createProject } from '@/server/projects/service';
import { createTask, updateTask } from '@/server/tasks/service';
import { createComment } from '@/server/comments/service';
import { listTaskFeed } from '@/server/activity/queries';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const madeTask = await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });
  if (!madeTask.ok) throw new Error('setup failed');
  return { ctx, taskId: madeTask.data.id };
}

describe('listTaskFeed', () => {
  it('interleaves comments and activity oldest first, with author names', async () => {
    const { ctx, taskId } = await setup('f1@example.com', 'ws-f1');
    await createComment(ctx, { taskId, body: 'Starting this' });
    await updateTask(ctx, { taskId, priority: 'high' });
    await createComment(ctx, { taskId, body: 'Nearly done' });

    const feed = await listTaskFeed(ctx, taskId);

    expect(feed.map((e) => e.type)).toEqual(['activity', 'comment', 'activity', 'comment']);
    expect(feed[0]).toMatchObject({ type: 'activity', kind: 'created', actorName: 'Ada' });
    expect(feed[1]).toMatchObject({ type: 'comment', body: 'Starting this', authorName: 'Ada' });
    expect(feed[2]).toMatchObject({ type: 'activity', kind: 'priority', from: 'none', to: 'high' });
    expect(feed[3]).toMatchObject({ type: 'comment', body: 'Nearly done' });
  });

  it('returns an empty feed for a task in another workspace', async () => {
    const a = await setup('f2a@example.com', 'ws-f2a');
    const b = await setup('f2b@example.com', 'ws-f2b');
    await createComment(a.ctx, { taskId: a.taskId, body: 'Private' });

    expect(await listTaskFeed(b.ctx, a.taskId)).toEqual([]);
  });

  // Review Focus 6 (spec §3.4): the clock is pinned to UTC by vitest.config.ts.
  it('carries an instant that renders as the next day in the workspace zone', async () => {
    const { ctx, taskId } = await setup('f3@example.com', 'ws-f3');
    const created = await createComment(ctx, { taskId, body: 'Late one' });
    if (!created.ok) throw new Error('setup failed');

    const feed = await listTaskFeed(ctx, taskId);
    const entry = feed.find((e) => e.type === 'comment')!;
    expect(entry.createdAt).toBeInstanceOf(Date);

    // 21:00 UTC on the 23rd is 01:00 on the 24th in Yerevan. The feed hands the
    // renderer an instant, so the zone is applied once, at render time.
    const at21Utc = new Date('2026-09-23T21:00:00Z');
    expect(formatInZone(at21Utc, ctx.timezone)).toBe('24 Sep 2026, 01:00');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `yarn test tests/server/feed.test.ts`
Expected: FAIL — `src/server/activity/queries` does not exist.

- [x] **Step 3: Write the query**

Create `src/server/activity/queries.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm';
import { comment, db, taskActivity, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { ACTIVITY_KINDS, type ActivityKind } from './service';

export type FeedEntry =
  | {
      type: 'comment';
      id: string;
      createdAt: Date;
      authorId: string;
      authorName: string;
      body: string;
      editedAt: Date | null;
    }
  | {
      type: 'activity';
      id: string;
      createdAt: Date;
      actorId: string;
      actorName: string;
      kind: ActivityKind;
      from: string | null;
      to: string | null;
    };

function isKnownKind(kind: string): kind is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(kind);
}

/**
 * Two indexed reads merged in memory rather than a UNION: the two row shapes
 * share no columns, and a task's feed is small enough that sorting it here costs
 * less than the casts a UNION would need. Both halves filter on workspace_id, so
 * a task id from another workspace yields nothing.
 */
export async function listTaskFeed(
  ctx: WorkspaceContext,
  taskId: string,
): Promise<FeedEntry[]> {
  const [comments, activity] = await Promise.all([
    db
      .select({
        id: comment.id,
        createdAt: comment.createdAt,
        authorId: comment.authorId,
        authorName: user.name,
        body: comment.body,
        editedAt: comment.editedAt,
      })
      .from(comment)
      .innerJoin(user, eq(user.id, comment.authorId))
      .where(and(eq(comment.taskId, taskId), eq(comment.workspaceId, ctx.workspaceId)))
      .orderBy(asc(comment.createdAt)),
    db
      .select({
        id: taskActivity.id,
        createdAt: taskActivity.createdAt,
        actorId: taskActivity.actorId,
        actorName: user.name,
        kind: taskActivity.kind,
        from: taskActivity.fromValue,
        to: taskActivity.toValue,
      })
      .from(taskActivity)
      .innerJoin(user, eq(user.id, taskActivity.actorId))
      .where(and(eq(taskActivity.taskId, taskId), eq(taskActivity.workspaceId, ctx.workspaceId)))
      .orderBy(asc(taskActivity.createdAt)),
  ]);

  const entries: FeedEntry[] = [
    ...comments.map((c) => ({ type: 'comment' as const, ...c })),
    // A kind written by an older deploy that this build does not know is dropped
    // rather than rendered as raw text.
    ...activity
      .filter((a) => isKnownKind(a.kind))
      .map((a) => ({ type: 'activity' as const, ...a, kind: a.kind as ActivityKind })),
  ];

  // Same-millisecond ties (a create and its activity row) fall back to id so the
  // order is stable between reads.
  return entries.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `yarn test tests/server/feed.test.ts`
Expected: PASS.

If the first case fails on ordering because a comment and an activity row share a millisecond, that is the tie-break doing its job on ids rather than time — fix it by widening the test's spacing with an `await new Promise((r) => setTimeout(r, 2))` between the three writes, not by loosening the assertion.

- [x] **Step 5: Commit**

```bash
git add src/server/activity/queries.ts tests/server/feed.test.ts
git commit -m "feat: merged comment and activity feed query"
```

---

### Task 5: Actions, feed UI, and dialog wiring

**Files:**
- Create: `src/server/comments/actions.ts`
- Create: `src/components/task/ActivityFeed.tsx`
- Modify: `src/components/task/TaskDetailDialog.tsx` (props and the section after `SubtaskSection`)
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx`
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/board/page.tsx`

**Interfaces:**
- Consumes: `createComment`, `updateComment`, `deleteComment` from `@/server/comments/service`; `listTaskFeed`, `FeedEntry` from `@/server/activity/queries`; `requireWorkspace` from `@/lib/session`; `formatInZone` from `@/lib/dates`.
- Produces:
  - `createCommentAction(workspaceSlug: string, input: { taskId: string; body: string }): Promise<Result<{ id: string }>>`
  - `updateCommentAction(workspaceSlug: string, input: { commentId: string; body: string }): Promise<Result<null>>`
  - `deleteCommentAction(workspaceSlug: string, input: { commentId: string }): Promise<Result<null>>`
  - `<ActivityFeed taskId feed workspaceSlug currentUserId canModerate timezone />`

- [x] **Step 1: Write the action wrappers**

Create `src/server/comments/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import { createComment, deleteComment, updateComment } from './service';

/**
 * Slug-taking wrappers only (Amendment A): every export here is a public HTTP
 * endpoint, so none of them may accept a caller-supplied WorkspaceContext.
 */

function revalidateWorkspace(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, 'layout');
}

export async function createCommentAction(
  workspaceSlug: string,
  input: { taskId: string; body: string },
): Promise<Result<{ id: string }>> {
  return withAction(async () => {
    const result = await createComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function updateCommentAction(
  workspaceSlug: string,
  input: { commentId: string; body: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function deleteCommentAction(
  workspaceSlug: string,
  input: { commentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteComment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
```

- [x] **Step 2: Write the feed component**

Create `src/components/task/ActivityFeed.tsx`:

```tsx
'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { formatInZone } from '@/lib/dates';
import {
  createCommentAction, deleteCommentAction, updateCommentAction,
} from '@/server/comments/actions';
import type { FeedEntry } from '@/server/activity/queries';

/** The one place an activity row turns into a sentence. */
function describeActivity(entry: Extract<FeedEntry, { type: 'activity' }>): string {
  switch (entry.kind) {
    case 'created':
      return 'created this task';
    case 'title':
      return `renamed it from “${entry.from}” to “${entry.to}”`;
    case 'status':
      return `moved it from ${entry.from} to ${entry.to}`;
    case 'priority':
      return `changed priority from ${entry.from} to ${entry.to}`;
    case 'assignee':
      return entry.to ? `assigned it to ${entry.to}` : `unassigned ${entry.from}`;
    case 'due_date':
      return entry.to ? `set the due date to ${entry.to}` : 'cleared the due date';
  }
}

export function ActivityFeed({
  taskId,
  feed,
  workspaceSlug,
  currentUserId,
  canModerate,
  timezone,
}: {
  taskId: string;
  feed: FeedEntry[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = inputRef.current?.value ?? '';
    if (!body.trim() || pending) return;

    startTransition(async () => {
      const result = await createCommentAction(workspaceSlug, { taskId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    });
  }

  function onEdit(commentId: string, body: string) {
    startTransition(async () => {
      const result = await updateCommentAction(workspaceSlug, { commentId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function onDelete(commentId: string) {
    if (!confirm('Delete this comment?')) return;
    startTransition(async () => {
      const result = await deleteCommentAction(workspaceSlug, { commentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-medium text-foreground">Activity</h3>

      <ol className="mt-3 space-y-3">
        {feed.map((entry) =>
          entry.type === 'activity' ? (
            <li key={entry.id} className="text-sm text-muted-foreground">
              <span className="text-foreground">{entry.actorName}</span>{' '}
              {describeActivity(entry)}
              <span className="ml-2 text-xs">{formatInZone(entry.createdAt, timezone)}</span>
            </li>
          ) : (
            <li key={entry.id} className="rounded-md bg-muted/40 p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-foreground">{entry.authorName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatInZone(entry.createdAt, timezone)}
                  {entry.editedAt && ' (edited)'}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {entry.authorId === currentUserId && editingId !== entry.id && (
                    <button
                      type="button"
                      onClick={() => setEditingId(entry.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                  )}
                  {(entry.authorId === currentUserId || canModerate) && (
                    <button
                      type="button"
                      aria-label={`Delete comment by ${entry.authorName}`}
                      onClick={() => onDelete(entry.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </span>
              </div>

              {editingId === entry.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('body');
                    onEdit(entry.id, String(value ?? ''));
                  }}
                  className="mt-2"
                >
                  <textarea
                    name="body"
                    defaultValue={entry.body}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="submit" disabled={pending} className="text-xs text-foreground">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                // Plain text in v1 (rich text is the next roadmap slice), so
                // whitespace is preserved rather than parsed.
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.body}</p>
              )}
            </li>
          ),
        )}
      </ol>

      <form onSubmit={onSubmit} className="mt-4">
        <label htmlFor="new-comment" className="sr-only">
          Comment
        </label>
        <textarea
          id="new-comment"
          ref={inputRef}
          rows={3}
          placeholder="Write a comment…"
          className="w-full rounded-md border border-input bg-background p-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-60"
        >
          Comment
        </button>
      </form>
    </section>
  );
}
```

- [x] **Step 3: Wire it into the dialog**

In `src/components/task/TaskDetailDialog.tsx`, add to the imports:

```tsx
import { ActivityFeed } from '@/components/task/ActivityFeed';
import type { FeedEntry } from '@/server/activity/queries';
```

Add four props to both the destructuring and the type:

```tsx
  feed,
  currentUserId,
  canModerate,
  timezone,
```

```tsx
  feed: FeedEntry[];
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
```

And render the feed immediately after the existing `<SubtaskSection ... />`:

```tsx
            <ActivityFeed
              taskId={task.id}
              feed={feed}
              workspaceSlug={workspaceSlug}
              currentUserId={currentUserId}
              canModerate={canModerate}
              timezone={timezone}
            />
```

- [x] **Step 4: Feed both pages**

In `src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx`, add the import and widen the conditional fetch:

```tsx
import { listTaskFeed } from '@/server/activity/queries';
```

```tsx
  const [members, allLabels, feed] = openTask
    ? await Promise.all([listWorkspaceMembers(ctx), listLabels(ctx), listTaskFeed(ctx, openTask.id)])
    : [[], [], []];
```

and pass the four new props:

```tsx
          feed={feed}
          currentUserId={ctx.userId}
          canModerate={ctx.role === 'owner' || ctx.role === 'admin'}
          timezone={ctx.timezone}
```

Apply the identical three edits to `src/app/(app)/[workspaceSlug]/projects/[projectId]/board/page.tsx`, which resolves `openTask` the same way at line 28.

- [x] **Step 5: Typecheck, lint, and run the whole suite**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: clean, and every existing test still green.

- [x] **Step 6: Check it in the browser**

Run: `yarn dev`, open a project, open a task, post a comment, change its priority in the dialog, and confirm both lines appear with the workspace-zone timestamp. Toggle the theme — no hardcoded color may break in dark mode.

- [x] **Step 7: Commit**

```bash
git add src/server/comments/actions.ts src/components/task/ActivityFeed.tsx src/components/task/TaskDetailDialog.tsx "src/app/(app)/[workspaceSlug]/projects/[projectId]/page.tsx" "src/app/(app)/[workspaceSlug]/projects/[projectId]/board/page.tsx"
git commit -m "feat: comment and activity feed in the task detail dialog"
```

---

### Task 6: End-to-end coverage

**Files:**
- Create: `tests/e2e/comments.spec.ts`

**Interfaces:**
- Consumes: the running app; the sign-up-through-project flow already proven by `tests/e2e/board.spec.ts`.
- Produces: nothing other tasks depend on.

- [x] **Step 1: Write the failing spec**

Create `tests/e2e/comments.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

/** Mirrors the helper in board.spec.ts: a fresh account, workspace, project, task. */
async function signUpWithTask(page: Page, prefix: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Comment Tester');
  await page.getByLabel('Email').fill(`${prefix}-${stamp}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Workspace name').fill(`Comments ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByPlaceholder('Add a task…').fill('Talk about me');
  await page.getByPlaceholder('Add a task…').press('Enter');
  await expect(page.getByText('Talk about me')).toBeVisible();
}

test('a comment survives a reload and priority changes show in the feed', async ({ page }) => {
  await signUpWithTask(page, 'comments');

  await page.getByRole('button', { name: 'Talk about me' }).first().click();
  await expect(page).toHaveURL(/\?task=/);

  // The feed opens with the creation entry already in it.
  await expect(page.getByText('created this task')).toBeVisible();

  await page.getByLabel('Comment').fill('First thoughts');
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByText('First thoughts')).toBeVisible();

  await page.reload();
  await expect(page.getByText('First thoughts')).toBeVisible();

  await page.getByLabel('Priority').click();
  await page.getByRole('option', { name: 'high' }).click();
  await expect(page.getByText('changed priority from none to high')).toBeVisible();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `yarn e2e tests/e2e/comments.spec.ts`
Expected: FAIL only if Task 5 is incomplete. If it fails on a selector — the priority control's accessible name, or the task-title button — read the rendered markup and fix the *selector*, not the component, unless the component genuinely lacks a label.

- [x] **Step 3: Run the whole suite**

Run: `yarn test && yarn e2e`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add tests/e2e/comments.spec.ts
git commit -m "test: end-to-end coverage for task comments and activity"
```

---

## Plan Self-Review

**Spec coverage.** §9's first deferred item is "comments and activity log", described as "additive tables". Task 1 adds exactly two additive tables with no change to existing columns. §4 tenancy: every new query filters on `ctx.workspaceId` (Tasks 3, 4), tested with cross-workspace cases. §5 mutation contract: all three actions return `Result<T>` through `withAction` (Task 5). §3.4 dates: the feed carries instants and renders through `formatInZone` (Tasks 4, 5). §6.1 tokens: the component uses semantic tokens only, and Lucide for its one icon (Task 5).

**Placeholders.** None: every code step carries the code, every test step carries the assertions, and no step defers a decision.

**Type consistency.** `ActivityKind` is defined once in `src/server/activity/service.ts` and imported by `queries.ts` and, transitively, by the component through `FeedEntry`. `recordActivity` keeps `ctx` first and the executor last, satisfying the global constraint. `FeedEntry` discriminates on `type` (not `kind`, which is the activity's own field) — `describeActivity` switches on `entry.kind` only after narrowing on `entry.type`, and that switch is exhaustive over `ACTIVITY_KINDS`, so adding a kind later is a compile error rather than a blank line in the feed.

**Review Focus.** All five plus the carried §3.4 case have tests: 1 and 3 in Task 3, 2 in Tasks 3 and 4, 4 and 5 in Task 2, the timezone case in Task 4.
