# Change Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bell items plus live toasts when a teammate changes a task I created or am assigned to, or renames, archives, unarchives or deletes a project.

**Architecture:** Notification rows are upserted in the same transaction as the write (`src/server/notifications/changes.ts`), merging into the recipient's unread row for the same subject and actor through partial unique indexes. The existing live refresh (Pusher or polling) re-renders the shell. The bell sees its unread count rise, fetches the list and toasts new change items.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM 0.45 on Postgres (`drizzle-kit push`), Sonner toasts, Vitest (server tests hit a real test DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-change-notifications-design.md`

## Global Constraints

- Branch: `feat/v2-updates`. Commit after every task. Plain commit messages, **no `Co-Authored-By` or any attribution trailer** (user rule).
- Do not change the package version.
- Kinds: `task_change`, `project_change` added to `notification_kind`; reminders and digests behave exactly as today (no toast, still emailed).
- Change notifications are never emailed.
- Task recipients: assignee + creator (+ previous assignee on reassignment) − actor, current workspace members only, `coalesce(user_settings.change_notify, true)`.
- Project recipients: all workspace members − actor, same toggle.
- Project events: rename, archive, unarchive, delete only. Not create, not color.
- Merge while unread: one unread row per (recipient, task|project, actor).
- Change rows use `dedupe_key = 'chg:' + newId()`.
- Comment excerpt ≤ 120 characters.
- Toasts: at most 3; more → one "N new updates" toast.
- Schema changes go in with `drizzle-kit push`. After Task 1, run `yarn db:setup:test` (test DB) and `yarn db:setup` (local dev DB) before running tests.
- After code changes, run `graphify update .` (project rule) in the final task.

## Review Focus

1. Two concurrent edits by the same actor to the same task must merge, never fail the user's edit with a unique-violation (`ON CONFLICT` targets the partial index; tested in Task 2).
2. A rolled-back write (unknown label, stale column) must leave no notification (helpers run inside the caller's transaction; tested in Task 3).
3. Deleting a project must keep the project "deleted" bell rows (`project_id` set null), while that project's task rows vanish with their tasks (tested in Task 4).
4. A recipient who left the workspace (stale assignee/creator) must not get rows (member join; tested in Task 2).
5. The email cron must never claim change rows, even unsent and fresh (tested in Task 5).

---

## File Structure

| file | responsibility |
|---|---|
| `src/db/schema/reminder.ts` | enum values, `actor_id`, `project_id`, two partial unique indexes |
| `src/db/schema/settings.ts` | `user_settings.change_notify` |
| `src/lib/notifications.ts` (new) | change payload types, bell text/href for all kinds, `pickToasts` (pure, client-safe) |
| `src/lib/reminders.ts` | `NotificationData` widened (type-only import from notifications) |
| `src/server/notifications/changes.ts` (new) | `notifyTaskChange`, `notifyProjectChange`, `commentExcerpt` |
| `src/server/notifications/queries.ts` | `NotificationItem` widened, selects `projectId` |
| `src/server/tasks/service.ts` | call sites: create, update/plan, bulk, move |
| `src/server/labels/service.ts` | `replaceTaskLabels` reports `changed`; `setTaskLabels` notifies |
| `src/server/comments/service.ts` | `createComment` notifies |
| `src/server/attachments/service.ts` | confirm/delete notify |
| `src/server/projects/service.ts` | rename/archive/unarchive/delete notify |
| `src/server/reminders/run.ts` | claim query filtered by kind |
| `src/server/user-settings/service.ts` | `changeNotify` in `ReminderPrefs` |
| `src/components/settings/ReminderPrefsForm.tsx` | the toggle |
| `src/components/shell/NotificationBell.tsx` | `bellText`/`bellHref`, toasts |

---

### Task 1: Schema and payload types

**Files:**
- Create: `src/lib/notifications.ts`
- Modify: `src/db/schema/reminder.ts`, `src/db/schema/settings.ts`, `src/lib/reminders.ts:40`
- Test: `tests/server/change-notifications.test.ts` (new)

**Interfaces:**
- Produces: `TASK_CHANGE_KINDS`, `TaskChangeKind`, `TaskChangeData`, `PROJECT_CHANGE_KINDS`, `ProjectChangeKind`, `ProjectChangeData` from `@/lib/notifications`; `notification.actorId`, `notification.projectId`, `userSettings.changeNotify` columns; enum values `'task_change' | 'project_change'`.

- [ ] **Step 1: Create `src/lib/notifications.ts` with the types**

```ts
/**
 * Change notifications: payload types, bell copy and links for every kind, and
 * which items toast. Pure, so the bell, the server and tests share it.
 */

export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment',
] as const;
export type TaskChangeKind = (typeof TASK_CHANGE_KINDS)[number];

export type TaskChangeData = {
  /** Task title as of the latest merged change. */
  title: string;
  projectName: string;
  actorName: string;
  /** Deduped, in order of first occurrence. */
  changes: TaskChangeKind[];
  /** The recipient became the assignee in one of the merged changes. */
  assignedToYou?: true;
  /** Latest new status name, when 'status' is among changes. */
  status?: string;
  /** Latest comment excerpt, when 'comment' is among changes. */
  comment?: string;
};

export const PROJECT_CHANGE_KINDS = ['renamed', 'archived', 'unarchived', 'deleted'] as const;
export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number];

export type ProjectChangeData = {
  /** Name before the first merged change. */
  projectName: string;
  /** Latest name, when 'renamed' is among changes. */
  newName?: string;
  actorName: string;
  changes: ProjectChangeKind[];
};
```

- [ ] **Step 2: Widen `NotificationData` in `src/lib/reminders.ts`**

At the top of the file add:

```ts
import type { ProjectChangeData, TaskChangeData } from './notifications';
```

Replace line 40:

```ts
export type NotificationData = ReminderData | DigestData | TaskChangeData | ProjectChangeData;
```

(Type-only import; `notifications.ts` will import runtime helpers from `reminders.ts` in Task 6, so `reminders.ts` must never import runtime values from `notifications.ts`.)

- [ ] **Step 3: Schema — `src/db/schema/reminder.ts`**

Add the project import:

```ts
import { project } from './project';
```

Replace the enum:

```ts
export const notificationKind = pgEnum('notification_kind', ['digest', 'reminder', 'task_change', 'project_change']);
```

In the `notification` table add, after `taskId`:

```ts
    // Change kinds only. Set null, not cascade: "Anna deleted Website" must
    // outlive the project it names.
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    // Who made the change (change kinds only); part of the merge key.
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
```

and in the index list add:

```ts
    // Merge targets: one unread change item per recipient, subject and actor
    // (src/server/notifications/changes.ts upserts on these). kind is compared as
    // text so the predicate never uses an enum value added in the same push.
    uniqueIndex('notification_open_task_change_uq')
      .on(t.userId, t.taskId, t.actorId)
      .where(sql`kind::text = 'task_change' and read_at is null`),
    uniqueIndex('notification_open_project_change_uq')
      .on(t.userId, t.projectId, t.actorId)
      .where(sql`kind::text = 'project_change' and read_at is null`),
```

Check for a circular import: `project.ts` must not import `reminder.ts` (`grep -n "reminder" src/db/schema/project.ts` → nothing).

- [ ] **Step 4: Schema — `src/db/schema/settings.ts`**

Add to `userSettings` after `digestEnabled`:

```ts
    // Bell + toast when a teammate changes my tasks or a project.
    changeNotify: boolean('change_notify').notNull().default(true),
```

- [ ] **Step 5: Push the schema**

Run: `yarn db:setup:test && yarn db:setup`
Expected: drizzle-kit reports the enum values, two columns, two indexes, one settings column; no data-loss prompt. If push fails with "unsafe use of new value", re-run it once (the enum values were committed by the first run).

- [ ] **Step 6: Write the schema test** — `tests/server/change-notifications.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
});

/** Ada owns the workspace and created "Ship" in "Website"; Bob is a member. */
async function setup() {
  const adaUser = await createUser('cn-ada@example.com', 'Ada');
  const bobUser = await createUser('cn-bob@example.com', 'Bob');
  const ws = await createWorkspace(adaUser.id, 'Acme', 'ws-cn');
  await joinWorkspace(bobUser.id, ws.id, 'member');
  const ada = ctxFor(adaUser.id, ws);
  const bob = ctxFor(bobUser.id, ws, 'member');
  const project = await createProject(ada, { name: 'Website' });
  if (!project.ok) throw new Error('setup');
  const made = await createTask(ada, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error('setup');
  return { ws, ada, bob, projectId: project.data.id, taskId: made.data.id };
}

const changeRow = (o: { userId: string; workspaceId: string; taskId: string; actorId: string }) => ({
  id: newId(), kind: 'task_change' as const, dedupeKey: `chg:${newId()}`,
  data: { title: 'Ship', projectName: 'Website', actorName: 'Bob', changes: ['title' as const] },
  ...o,
});

describe('schema', () => {
  it('allows one unread change row per recipient, task and actor', async () => {
    const { ada, bob, taskId } = await setup();
    const key = { userId: ada.userId, workspaceId: ada.workspaceId, taskId, actorId: bob.userId };
    await db.insert(notification).values(changeRow(key));
    await expect(db.insert(notification).values(changeRow(key))).rejects.toThrow();
  });

  it('allows a new unread row once the old one is read', async () => {
    const { ada, bob, taskId } = await setup();
    const key = { userId: ada.userId, workspaceId: ada.workspaceId, taskId, actorId: bob.userId };
    await db.insert(notification).values({ ...changeRow(key), readAt: new Date() });
    await db.insert(notification).values(changeRow(key));
    expect(await db.select().from(notification)).toHaveLength(2);
  });
});
```

- [ ] **Step 7: Run it**

Run: `yarn test tests/server/change-notifications.test.ts`
Expected: 2 passed.

- [ ] **Step 8: Typecheck and commit**

Run: `yarn typecheck` → no errors.

```bash
git add src/lib/notifications.ts src/lib/reminders.ts src/db/schema/reminder.ts src/db/schema/settings.ts tests/server/change-notifications.test.ts
git commit -m "feat(notifications): schema for change notifications"
```

---

### Task 2: Notification helpers

**Files:**
- Create: `src/server/notifications/changes.ts`
- Test: `tests/server/change-notifications.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types and columns; `Executor` from `@/server/activity/service`.
- Produces:
  - `notifyTaskChange(ctx: WorkspaceContext, tx: Executor, input: { taskId: string; changes: TaskChangeKind[]; previousAssigneeId?: string | null; status?: string; comment?: string }): Promise<void>`
  - `notifyProjectChange(ctx: WorkspaceContext, tx: Executor, input: { projectId: string; change: ProjectChangeKind; projectName: string; newName?: string }): Promise<void>`
  - `commentExcerpt(body: string): string`

- [ ] **Step 1: Write failing tests** (append to `tests/server/change-notifications.test.ts`)

Add imports at the top:

```ts
import { eq } from 'drizzle-orm';
import { userSettings } from '@/db';
import { commentExcerpt, notifyProjectChange, notifyTaskChange } from '@/server/notifications/changes';
import { task } from '@/db';
```

Then:

```ts
const rows = () => db.select().from(notification).orderBy(notification.createdAt);

describe('notifyTaskChange', () => {
  it('notifies the creator, not the actor', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title', 'priority'] }));
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: ada.userId, actorId: bob.userId, kind: 'task_change', taskId, readAt: null });
    expect(row.dedupeKey).toMatch(/^chg:/);
    expect(row.data).toEqual({ title: 'Ship', projectName: 'Website', actorName: 'Bob', changes: ['title', 'priority'] });
  });

  it('does nothing when the actor is the only one involved', async () => {
    const { ada, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(ada, tx, { taskId, changes: ['title'] }));
    expect(await rows()).toHaveLength(0);
  });

  it('merges a second change into the unread row, in first-seen order', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title', 'priority'] }));
    const [first] = await rows();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority', 'status'], status: 'Done' }));
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(all[0].data).toMatchObject({ changes: ['title', 'priority', 'status'], status: 'Done' });
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
    expect(all[0].userId).toBe(ada.userId);
  });

  it('keeps an earlier comment excerpt and assignment through a later merge', async () => {
    const { ada, bob, taskId } = await setup();
    await db.update(task).set({ assigneeId: ada.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['assignee'] }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['comment'], comment: 'Looks good' }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    const [row] = await rows();
    expect(row.data).toMatchObject({ assignedToYou: true, comment: 'Looks good', changes: ['assignee', 'comment', 'title'] });
  });

  it('starts a new row once the old one is read', async () => {
    const { bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    await db.update(notification).set({ readAt: new Date() });
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority'] }));
    expect(await rows()).toHaveLength(2);
  });

  it('keeps separate rows per actor', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await db.update(task).set({ assigneeId: bob.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(ctxFor(cy.id, ws, 'member'), tx, { taskId, changes: ['title'] }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    const all = await rows();
    // Ada from Cy, Bob from Cy, Ada from Bob.
    expect(all.map((r) => [r.userId, r.actorId]).sort()).toEqual(
      [[ada.userId, cy.id], [bob.userId, cy.id], [ada.userId, bob.userId]].sort(),
    );
  });

  it('tells the new assignee they were assigned and the previous one what changed', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy2@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    // Bob reassigns from Cy to Ada (who also created the task).
    await db.update(task).set({ assigneeId: ada.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['assignee'], previousAssigneeId: cy.id }));
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r.data]));
    expect(byUser[ada.userId]).toMatchObject({ assignedToYou: true });
    expect(byUser[cy.id]).toMatchObject({ changes: ['assignee'] });
    expect(byUser[cy.id]).not.toHaveProperty('assignedToYou');
  });

  it('skips recipients who turned it off or left the workspace', async () => {
    const { ada, bob, taskId } = await setup();
    const gone = await createUser('cn-gone@example.com', 'Gone');
    await db.update(task).set({ assigneeId: gone.id }).where(eq(task.id, taskId));
    await db.insert(userSettings).values({ userId: ada.userId, changeNotify: false });
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    expect(await rows()).toHaveLength(0);
  });

  it('merges concurrent changes by one actor instead of failing', async () => {
    const { bob, taskId } = await setup();
    await Promise.all([
      db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] })),
      db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority'] })),
    ]);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect([...(all[0].data as { changes: string[] }).changes].sort()).toEqual(['priority', 'title']);
  });

  it('leaves nothing behind when the transaction rolls back', async () => {
    const { bob, taskId } = await setup();
    await expect(db.transaction(async (tx) => {
      await notifyTaskChange(bob, tx, { taskId, changes: ['title'] });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
  });
});

describe('notifyProjectChange', () => {
  it('notifies every other member and merges archive then unarchive', async () => {
    const { ws, ada, bob, projectId } = await setup();
    const cy = await createUser('cn-cy3@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'archived', projectName: 'Website' }));
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'unarchived', projectName: 'Website' }));
    const all = await rows();
    expect(all.map((r) => r.userId).sort()).toEqual([bob.userId, cy.id].sort());
    for (const r of all) {
      expect(r).toMatchObject({ kind: 'project_change', projectId, actorId: ada.userId, taskId: null });
      expect(r.data).toEqual({ projectName: 'Website', actorName: 'Ada', changes: ['archived', 'unarchived'] });
    }
  });

  it('keeps the original name and the latest new name across renames', async () => {
    const { ada, projectId } = await setup();
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'renamed', projectName: 'Website', newName: 'Site' }));
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'renamed', projectName: 'Site', newName: 'Site v2' }));
    const [row] = await rows();
    expect(row.data).toEqual({ projectName: 'Website', newName: 'Site v2', actorName: 'Ada', changes: ['renamed'] });
  });
});

describe('commentExcerpt', () => {
  it('flattens whitespace and caps at 120 characters', () => {
    expect(commentExcerpt('  a\n\nb  ')).toBe('a b');
    const long = commentExcerpt('x'.repeat(200));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });
});
```


- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/server/change-notifications.test.ts`
Expected: FAIL — cannot resolve `@/server/notifications/changes`.

- [ ] **Step 3: Implement `src/server/notifications/changes.ts`**

```ts
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { member, project, task, user, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import type {
  ProjectChangeData, ProjectChangeKind, TaskChangeData, TaskChangeKind,
} from '@/lib/notifications';
import type { WorkspaceContext } from '@/lib/session';
import type { Executor } from '@/server/activity/service';

const COMMENT_EXCERPT = 120;

export function commentExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > COMMENT_EXCERPT ? `${flat.slice(0, COMMENT_EXCERPT - 1)}…` : flat;
}

/**
 * Members of this workspace other than the actor who have change notifications
 * on, optionally narrowed to `candidates`. A stale assignee or creator who has
 * left the workspace drops out here.
 */
async function recipients(ctx: WorkspaceContext, tx: Executor, candidates: string[] | null): Promise<string[]> {
  if (candidates && candidates.length === 0) return [];
  const rows = await tx
    .select({ id: member.userId })
    .from(member)
    .leftJoin(userSettings, eq(userSettings.userId, member.userId))
    .where(and(
      eq(member.organizationId, ctx.workspaceId),
      ne(member.userId, ctx.userId),
      sql`coalesce(${userSettings.changeNotify}, true)`,
      candidates ? inArray(member.userId, candidates) : undefined,
    ));
  return rows.map((r) => r.id);
}

async function actorName(ctx: WorkspaceContext, tx: Executor): Promise<string> {
  const [row] = await tx.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId)).limit(1);
  return row?.name ?? 'Someone';
}

/** The `changes` arrays of the stored and incoming rows: stored order first, then what incoming adds. */
const mergedChanges = sql`(
  SELECT coalesce(jsonb_agg(c ORDER BY o), '[]'::jsonb) FROM (
    SELECT c, min(o) AS o FROM (
      SELECT x.c, x.o FROM jsonb_array_elements(n.data->'changes') WITH ORDINALITY AS x(c, o)
      UNION ALL
      SELECT y.c, y.o + 1000 FROM jsonb_array_elements(EXCLUDED.data->'changes') WITH ORDINALITY AS y(c, o)
    ) u GROUP BY c
  ) m
)`;

/** Keeps the stored `key` when the incoming payload lacks it. */
const keepStored = (key: string) =>
  sql`CASE WHEN (n.data ? ${key}) AND NOT (EXCLUDED.data ? ${key})
    THEN jsonb_build_object(${key}::text, n.data->${key}) ELSE '{}'::jsonb END`;

function values(rows: SQL[]): SQL {
  return sql.join(rows, sql`, `);
}

export async function notifyTaskChange(
  ctx: WorkspaceContext,
  tx: Executor,
  input: {
    taskId: string;
    changes: TaskChangeKind[];
    /** On reassignment: the assignee before the change, who hears about it too. */
    previousAssigneeId?: string | null;
    status?: string;
    comment?: string;
  },
): Promise<void> {
  const changes = [...new Set(input.changes)];
  if (changes.length === 0) return;

  const [row] = await tx
    .select({ title: task.title, assigneeId: task.assigneeId, createdBy: task.createdBy, projectName: project.name })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(eq(task.id, input.taskId), eq(task.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!row) return;

  const involved = [row.assigneeId, row.createdBy, input.previousAssigneeId]
    .filter((id): id is string => Boolean(id));
  const ids = await recipients(ctx, tx, [...new Set(involved)]);
  if (ids.length === 0) return;

  const name = await actorName(ctx, tx);
  const assigned = changes.includes('assignee');
  const dataFor = (userId: string): TaskChangeData => ({
    title: row.title,
    projectName: row.projectName,
    actorName: name,
    changes,
    ...(assigned && userId === row.assigneeId ? { assignedToYou: true as const } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
  });

  await tx.execute(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, task_id, actor_id, dedupe_key, data)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'task_change', ${input.taskId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${JSON.stringify(dataFor(userId))}::jsonb
    )`))}
    ON CONFLICT (user_id, task_id, actor_id) WHERE kind::text = 'task_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('changes', ${mergedChanges})
        || CASE WHEN n.data ? 'assignedToYou' THEN '{"assignedToYou": true}'::jsonb ELSE '{}'::jsonb END
        || ${keepStored('comment')}
        || ${keepStored('status')},
      created_at = now()
  `);
}

export async function notifyProjectChange(
  ctx: WorkspaceContext,
  tx: Executor,
  input: {
    projectId: string;
    change: ProjectChangeKind;
    /** The name before this change: rename and delete have already altered the row. */
    projectName: string;
    newName?: string;
  },
): Promise<void> {
  const ids = await recipients(ctx, tx, null);
  if (ids.length === 0) return;

  const data: ProjectChangeData = {
    projectName: input.projectName,
    ...(input.newName ? { newName: input.newName } : {}),
    actorName: await actorName(ctx, tx),
    changes: [input.change],
  };
  const json = JSON.stringify(data);

  await tx.execute(sql`
    INSERT INTO notification AS n (id, user_id, workspace_id, kind, project_id, actor_id, dedupe_key, data)
    VALUES ${values(ids.map((userId) => sql`(
      ${newId()}, ${userId}, ${ctx.workspaceId}, 'project_change', ${input.projectId}, ${ctx.userId},
      ${`chg:${newId()}`}, ${json}::jsonb
    )`))}
    ON CONFLICT (user_id, project_id, actor_id) WHERE kind::text = 'project_change' AND read_at IS NULL
    DO UPDATE SET
      data = EXCLUDED.data
        || jsonb_build_object('projectName', n.data->'projectName', 'changes', ${mergedChanges})
        || ${keepStored('newName')},
      created_at = now()
  `);
}
```

Notes for the implementer:
- `?` is the jsonb key-exists operator; node-postgres uses `$n` placeholders so a literal `?` is safe.
- If Postgres rejects `${key}::text` inside `jsonb_build_object` as ambiguous, the parameter is already text; keep the cast.
- `created_at = now()` is the transaction start time, which is fine.

- [ ] **Step 4: Run tests**

Run: `yarn test tests/server/change-notifications.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/notifications/changes.ts tests/server/change-notifications.test.ts
git commit -m "feat(notifications): upsert change notifications for tasks and projects"
```

---

### Task 3: Task, label, comment and attachment call sites

**Files:**
- Modify: `src/server/tasks/service.ts` (loadOwnedTask ~50, createTask ~185, UpdatePlan ~222, planUpdate ~228-264, applyUpdate ~267, updateTaskAndLabels ~298, moveTask ~430)
- Modify: `src/server/labels/service.ts:56-118`
- Modify: `src/server/comments/service.ts:25-58`
- Modify: `src/server/attachments/service.ts` (confirmUpload ~126, deleteAttachment ~185)
- Test: `tests/server/change-notifications.test.ts` (append), `tests/server/attachments.test.ts` (append)

**Interfaces:**
- Consumes: `notifyTaskChange`, `commentExcerpt` (Task 2); `TaskChangeKind` (Task 1).
- Produces: `replaceTaskLabels(...)` now returns `Promise<Result<{ changed: boolean }>>`.

- [ ] **Step 1: Write failing tests** (append to `tests/server/change-notifications.test.ts`)

Add imports:

```ts
import { createLabel, setTaskLabels } from '@/server/labels/service';
import { createComment } from '@/server/comments/service';
import { bulkUpdateTasks, moveTask, updateTask, updateTaskAndLabels } from '@/server/tasks/service';
import { taskStatus } from '@/db';
```

```ts
async function statuses(projectId: string) {
  return db.select().from(taskStatus).where(eq(taskStatus.projectId, projectId)).orderBy(taskStatus.position);
}

describe('task call sites', () => {
  it('updateTask notifies with every changed field, description included', async () => {
    const { ada, bob, taskId } = await setup();
    expect((await updateTask(bob, { taskId, title: 'Ship it', description: 'Now', priority: 'high' })).ok).toBe(true);
    const [row] = await rows();
    expect(row.userId).toBe(ada.userId);
    expect(row.data).toMatchObject({ title: 'Ship it', changes: ['title', 'priority', 'description'] });
  });

  it('an update that changes nothing notifies no one', async () => {
    const { bob, taskId } = await setup();
    await updateTask(bob, { taskId, title: 'Ship' });
    expect(await rows()).toHaveLength(0);
  });

  it('reassignment tells the new assignee and the previous one', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy4@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await updateTask(ada, { taskId, assigneeId: cy.id });
    expect(await rows()).toMatchObject([{ userId: cy.id, data: { assignedToYou: true } }]);
    await db.delete(notification);
    await updateTask(ada, { taskId, assigneeId: bob.userId });
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r.data]));
    expect(byUser[bob.userId]).toMatchObject({ assignedToYou: true });
    expect(byUser[cy.id]).toMatchObject({ changes: ['assignee'] });
  });

  it('labels via updateTaskAndLabels merge into the same row; an unknown label rolls everything back', async () => {
    const { ada, bob, taskId } = await setup();
    const bug = await createLabel(ada, { name: 'Bug' });
    if (!bug.ok) throw new Error('setup');
    await updateTaskAndLabels(bob, { taskId, title: 'Ship 2' }, [bug.data.id]);
    expect((await rows())[0].data).toMatchObject({ changes: ['title', 'labels'] });

    await db.delete(notification);
    const failed = await updateTaskAndLabels(bob, { taskId, title: 'Ship 3' }, ['nope']);
    expect(failed.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it('setTaskLabels notifies only when the set changes', async () => {
    const { ada, bob, taskId } = await setup();
    const bug = await createLabel(ada, { name: 'Bug' });
    if (!bug.ok) throw new Error('setup');
    await setTaskLabels(bob, { taskId, labelIds: [bug.data.id] });
    expect(await rows()).toHaveLength(1);
    await db.delete(notification);
    await setTaskLabels(bob, { taskId, labelIds: [bug.data.id] });
    expect(await rows()).toHaveLength(0);
  });

  it('a board move across columns notifies with the new status; a reorder does not', async () => {
    const { bob, taskId, projectId } = await setup();
    const [todo, , done] = await statuses(projectId);
    await moveTask(bob, { taskId, statusId: todo.id, beforeId: null, afterId: null });
    expect(await rows()).toHaveLength(0);
    await moveTask(bob, { taskId, statusId: done.id, beforeId: null, afterId: null });
    expect((await rows())[0].data).toMatchObject({ changes: ['status'], status: 'Done' });
  });

  it('bulk updates notify per task', async () => {
    const { ada, bob, taskId, projectId } = await setup();
    const second = await createTask(ada, { projectId, title: 'Docs' });
    if (!second.ok) throw new Error('setup');
    await bulkUpdateTasks(bob, { taskIds: [taskId, second.data.id], patch: { priority: 'high' } });
    expect((await rows()).map((r) => r.taskId).sort()).toEqual([taskId, second.data.id].sort());
  });

  it('creating a task assigned to someone else tells them', async () => {
    const { ada, bob, projectId } = await setup();
    const made = await createTask(ada, { projectId, title: 'For Bob', assigneeId: bob.userId });
    if (!made.ok) throw new Error('setup');
    expect(await rows()).toMatchObject([{ userId: bob.userId, taskId: made.data.id, data: { assignedToYou: true, changes: ['assignee'] } }]);
  });

  it('a comment notifies with an excerpt', async () => {
    const { ada, bob, taskId } = await setup();
    await createComment(bob, { taskId, body: 'Looks\n\ngood' });
    expect(await rows()).toMatchObject([{ userId: ada.userId, data: { changes: ['comment'], comment: 'Looks good' } }]);
  });
});
```

Append to `tests/server/attachments.test.ts` (inside a new `describe`, reusing that file's `setup`, `addMember`, `attach`):

```ts
describe('change notifications', () => {
  it('adding and removing an attachment notifies the task creator', async () => {
    const { ctx, ws, taskId } = await setup('an1@example.com', 'ws-an1');
    const grace = await addMember(ws.id, ws.slug, 'an1-grace@example.com', 'admin');
    const view = await attach(grace, taskId);
    await deleteAttachment(grace, { attachmentId: view.id });
    const rows = await db.select().from(notification);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ctx.userId, data: { changes: ['attachment'] } });
  });
});
```

Add `notification` to that file's `@/db` import. Check `attach` returns an object with `id` (it returns `AttachmentView`; use its id field — confirm with `grep -n "export type AttachmentView" -A8 src/server/attachments/*.ts`).

- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/server/change-notifications.test.ts tests/server/attachments.test.ts`
Expected: the new call-site tests FAIL (no rows); earlier tests pass.

- [ ] **Step 3: `src/server/labels/service.ts` — report whether labels changed and notify in `setTaskLabels`**

In `replaceTaskLabels`, change the return type to `Promise<Result<{ changed: boolean }>>`, read the old set before deleting, and return the comparison:

```ts
  const before = await tx.select({ id: taskLabel.labelId }).from(taskLabel).where(eq(taskLabel.taskId, taskId));
  const changed = before.length !== labelIds.length || before.some((b) => !labelIds.includes(b.id));

  await tx.delete(taskLabel).where(eq(taskLabel.taskId, taskId));
  if (labelIds.length > 0) {
    await tx.insert(taskLabel).values(labelIds.map((labelId) => ({ taskId, labelId })));
  }
  await tx.update(task).set({ updatedAt: new Date() }).where(eq(task.id, taskId));
  return ok({ changed });
```

In `setTaskLabels`, inside the transaction:

```ts
    const result = await db.transaction(async (tx) => {
      const replaced = await replaceTaskLabels(ctx, tx, parsed.data.taskId, parsed.data.labelIds);
      if (!replaced.ok) return replaced;
      if (replaced.data.changed) await notifyTaskChange(ctx, tx, { taskId: parsed.data.taskId, changes: ['labels'] });
      await emitChange(ctx, { projectId: owned.projectId }, tx);
      return replaced;
    });
```

Import: `import { notifyTaskChange } from '@/server/notifications/changes';`. Check that `changes.ts` does not import `labels/service` (it doesn't) so no cycle.

- [ ] **Step 4: `src/server/tasks/service.ts`**

Import:

```ts
import type { TaskChangeKind } from '@/lib/notifications';
import { notifyTaskChange } from '@/server/notifications/changes';
```

`loadOwnedTask`: add `description: task.description,` to the select.

`UpdatePlan`: add

```ts
  /** What recipients are told changed: the activity kinds plus description. */
  changes: TaskChangeKind[];
  /** The task's new status name, when it changes column. */
  newStatusName: string | null;
```

End of `planUpdate`, replace `return ok({ taskId: parsed.data.taskId, owned, patch, entries });` with:

```ts
  // Activity kinds that are also change kinds map 1:1; description has no activity row.
  const changes: TaskChangeKind[] = entries.map((e) => e.kind as TaskChangeKind);
  if (patch.description !== undefined && patch.description !== owned.description) changes.push('description');

  return ok({ taskId: parsed.data.taskId, owned, patch, entries, changes, newStatusName });
```

(The activity kinds produced here are only `title`, `priority`, `due_date`, `assignee`, `status`, all members of `TASK_CHANGE_KINDS`.)

`applyUpdate`, after the `recordActivity` loop:

```ts
  const reassigned = patch.assigneeId !== undefined && patch.assigneeId !== owned.assigneeId;
  await notifyTaskChange(ctx, tx, {
    taskId: plan.taskId,
    changes: plan.changes,
    previousAssigneeId: reassigned ? owned.assigneeId : null,
    ...(plan.newStatusName && plan.changes.includes('status') ? { status: plan.newStatusName } : {}),
  });
```

(Note `patch` here is the local copy; `patch.assigneeId` is unchanged by the column-move code.) This covers `updateTask`, `updateTaskAndLabels` and `bulkUpdateTasks`.

`updateTaskAndLabels`, replace the labels block:

```ts
        if (labelIds) {
          const labelled = await replaceTaskLabels(ctx, tx, plan.data.taskId, labelIds);
          if (!labelled.ok) throw new RolledBack(labelled);
          if (labelled.data.changed) await notifyTaskChange(ctx, tx, { taskId: plan.data.taskId, changes: ['labels'] });
        }
```

`createTask`, after `recordActivity(... 'created' ...)`:

```ts
      if (assigneeId && assigneeId !== ctx.userId) {
        await notifyTaskChange(ctx, tx, { taskId: id, changes: ['assignee'] });
      }
```

(Confirm the local variable holding the validated assignee is named `assigneeId` in `createTask`: `grep -n "assigneeId" src/server/tasks/service.ts | sed -n 1,10p`.)

`moveTask`, inside `if (crossedColumn) { ... }` after `recordActivity`:

```ts
        await notifyTaskChange(ctx, tx, { taskId: parsed.data.taskId, changes: ['status'], status: status.name });
```

- [ ] **Step 5: `src/server/comments/service.ts` — `createComment`**

Import `import { commentExcerpt, notifyTaskChange } from '@/server/notifications/changes';` and after the `tx.insert(comment)`:

```ts
      await notifyTaskChange(ctx, tx, {
        taskId: parsed.data.taskId, changes: ['comment'], comment: commentExcerpt(parsed.data.body),
      });
```

- [ ] **Step 6: `src/server/attachments/service.ts`**

Import `notifyTaskChange`. In `confirmUpload`'s transaction after `recordActivity(... 'attachment_added' ...)` and in `deleteAttachment`'s after `recordActivity(... 'attachment_removed' ...)`:

```ts
      await notifyTaskChange(ctx, tx, { taskId: row.taskId, changes: ['attachment'] });
```

- [ ] **Step 7: Run tests**

Run: `yarn test tests/server/change-notifications.test.ts tests/server/attachments.test.ts tests/server/tasks.test.ts tests/server/labels.test.ts tests/server/comments.test.ts tests/server/activity.test.ts tests/server/api-v1-tasks.test.ts`
Expected: all pass. If an existing label test asserted `replaceTaskLabels` returns `ok(null)`, update it to `ok({ changed: true })`.

- [ ] **Step 8: Typecheck and commit**

Run: `yarn typecheck`

```bash
git add src/server tests/server
git commit -m "feat(notifications): notify on task edits, moves, labels, comments and attachments"
```

---

### Task 4: Project call sites

**Files:**
- Modify: `src/server/projects/service.ts:89-230`
- Test: `tests/server/change-notifications.test.ts` (append)

**Interfaces:**
- Consumes: `notifyProjectChange` (Task 2).

- [ ] **Step 1: Write failing tests**

Add imports:

```ts
import { archiveProject, deleteProject, renameProject, setProjectColor, unarchiveProject } from '@/server/projects/service';
```

(Merge with the existing `createProject` import.)

```ts
describe('project call sites', () => {
  it('rename notifies other members with old and new names; same name does not', async () => {
    const { ada, bob, projectId } = await setup();
    await renameProject(ada, { projectId, name: 'Website' });
    expect(await rows()).toHaveLength(0);
    await renameProject(ada, { projectId, name: 'Site' });
    expect(await rows()).toMatchObject([
      { userId: bob.userId, projectId, data: { projectName: 'Website', newName: 'Site', changes: ['renamed'] } },
    ]);
  });

  it('archive and unarchive merge into one unread row', async () => {
    const { ada, projectId } = await setup();
    await archiveProject(ada, { projectId });
    await unarchiveProject(ada, { projectId });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].data).toMatchObject({ changes: ['archived', 'unarchived'] });
  });

  it('color changes notify no one', async () => {
    const { ada, projectId } = await setup();
    await setProjectColor(ada, { projectId, color: 'success' });
    expect(await rows()).toHaveLength(0);
  });

  it('delete keeps the project row for members; task rows go with the tasks', async () => {
    const { ada, bob, projectId, taskId } = await setup();
    await updateTask(bob, { taskId, title: 'Ship 2' }); // a task_change row for Ada
    await deleteProject(ada, { projectId });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      userId: bob.userId, kind: 'project_change', projectId: null,
      data: { projectName: 'Website', changes: ['deleted'] },
    });
  });
});
```

Check `'success'` is in `PROJECT_COLOR_KEYS` (`grep -n PROJECT_COLOR_KEYS -A3 src/components/brand/tint.ts`); use any listed key other than `'primary'`.

- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/server/change-notifications.test.ts -t "project call sites"`
Expected: FAIL (no rows).

- [ ] **Step 3: Implement in `src/server/projects/service.ts`**

Import `import { notifyProjectChange } from '@/server/notifications/changes';`.

`renameProject` transaction body:

```ts
  const updated = await db.transaction(async (tx) => {
    const scope = and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, ctx.workspaceId));
    // Read under a row lock: the notification names the project as it was.
    const [before] = await tx.select({ name: project.name }).from(project).where(scope).for('update');
    if (!before) return [];
    const rows = await tx
      .update(project)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(scope)
      .returning({ id: project.id });
    await emitChange(ctx, { projectId: parsed.data.projectId }, tx);
    if (before.name !== parsed.data.name) {
      await notifyProjectChange(ctx, tx, {
        projectId: parsed.data.projectId, change: 'renamed', projectName: before.name, newName: parsed.data.name,
      });
    }
    return rows;
  });
```

`archiveProject`: change `.returning({ id: project.id })` to `.returning({ id: project.id, name: project.name })` and:

```ts
    if (rows.length > 0) {
      await emitChange(ctx, { projectId: input.projectId }, tx);
      await notifyProjectChange(ctx, tx, { projectId: input.projectId, change: 'archived', projectName: rows[0].name });
    }
```

`unarchiveProject`: same with `change: 'unarchived'`.

`deleteProject`: select the name with the ownership check and notify before the deletes:

```ts
    const [owned] = await tx
      .select({ id: project.id, name: project.name })
      ...
    if (!owned) return { result: err('Project not found.'), keys: [] as string[] };
    const keys = await attachmentKeysForProject(tx, ctx.workspaceId, input.projectId);
    // Before the deletes: the rows reference the project, and its delete sets that to null.
    await notifyProjectChange(ctx, tx, { projectId: input.projectId, change: 'deleted', projectName: owned.name });
```

- [ ] **Step 4: Run tests**

Run: `yarn test tests/server/change-notifications.test.ts tests/server/projects.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/projects/service.ts tests/server/change-notifications.test.ts
git commit -m "feat(notifications): notify members when a project is renamed, archived or deleted"
```

---

### Task 5: Bell copy, links and toast selection

**Files:**
- Modify: `src/lib/notifications.ts`
- Test: `tests/unit/notifications.test.ts` (new)

**Interfaces:**
- Consumes: `notificationText`, `notificationHref`, `ReminderData`, `DigestData`, `NotificationData` from `@/lib/reminders`; Task 1 types.
- Produces:
  - `type BellKind = 'reminder' | 'digest' | 'task_change' | 'project_change'`
  - `type BellItem = { kind: BellKind; taskId: string | null; projectId: string | null; data: NotificationData }`
  - `bellText(item: BellItem): { title: string; detail: string }`
  - `bellHref(slug: string, item: BellItem): string`
  - `pickToasts<T extends { kind: BellKind; readAt: Date | string | null; createdAt: Date | string }>(items: T[], since: number): T[]`
  - `MAX_TOASTS = 3`

- [ ] **Step 1: Write failing tests** — `tests/unit/notifications.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { bellHref, bellText, pickToasts, type BellItem } from '@/lib/notifications';

const task = (data: object): BellItem => ({
  kind: 'task_change', taskId: 't1', projectId: null,
  data: { title: 'Ship', projectName: 'Web', actorName: 'Anna', changes: ['title'], ...data } as BellItem['data'],
});
const proj = (data: object, projectId: string | null = 'p1'): BellItem => ({
  kind: 'project_change', taskId: null, projectId,
  data: { projectName: 'Website', actorName: 'Anna', changes: ['renamed'], ...data } as BellItem['data'],
});

describe('bellText', () => {
  it('describes task changes', () => {
    expect(bellText(task({ changes: ['status', 'priority', 'due_date'] }))).toEqual({ title: 'Ship', detail: 'Anna changed status, priority, due date' });
    expect(bellText(task({ changes: ['assignee', 'title'], assignedToYou: true })).detail).toBe('Anna assigned you');
    expect(bellText(task({ changes: ['comment'], comment: 'Looks good' })).detail).toBe('Anna commented: “Looks good”');
    expect(bellText(task({ changes: ['status'], status: 'Done' })).detail).toBe('Anna moved to Done');
    expect(bellText(task({ changes: ['attachment', 'labels'] })).detail).toBe('Anna changed attachments, labels');
  });

  it('describes project changes', () => {
    expect(bellText(proj({ newName: 'Site v2' }))).toEqual({ title: 'Website', detail: 'Anna renamed to Site v2' });
    expect(bellText(proj({ changes: ['archived'] })).detail).toBe('Anna archived this project');
    expect(bellText(proj({ changes: ['unarchived'] })).detail).toBe('Anna restored this project');
    expect(bellText(proj({ changes: ['deleted'] })).detail).toBe('Anna deleted this project');
    expect(bellText(proj({ changes: ['renamed', 'archived'], newName: 'X' })).detail).toBe('Anna renamed, archived');
  });

  it('still describes reminders', () => {
    const item: BellItem = {
      kind: 'reminder', taskId: 't1', projectId: null,
      data: { title: 'Ship', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 0, daysLeft: 0 },
    };
    expect(bellText(item)).toEqual({ title: 'Ship', detail: 'Due today · Web' });
    expect(bellHref('acme', item)).toBe('/acme/tasks/t1');
  });
});

describe('bellHref', () => {
  it('links each kind', () => {
    expect(bellHref('acme', task({}))).toBe('/acme/tasks/t1');
    expect(bellHref('acme', { ...task({}), taskId: null })).toBe('/acme');
    expect(bellHref('acme', proj({}))).toBe('/acme/projects/p1');
    expect(bellHref('acme', proj({ changes: ['renamed', 'archived'] }))).toBe('/acme/settings/projects');
    expect(bellHref('acme', proj({ changes: ['archived', 'unarchived'] }))).toBe('/acme/projects/p1');
    expect(bellHref('acme', proj({ changes: ['deleted'] }))).toBe('/acme');
    expect(bellHref('acme', proj({}, null))).toBe('/acme');
  });
});

describe('pickToasts', () => {
  const at = (iso: string) => new Date(iso);
  const since = at('2026-10-07T10:00:00Z').getTime();
  const item = (kind: BellItem['kind'], createdAt: string, readAt: string | null = null, id = createdAt) =>
    ({ id, kind, createdAt: at(createdAt), readAt: readAt ? at(readAt) : null });

  it('keeps unread change items newer than the cutoff, newest first', () => {
    const picked = pickToasts([
      item('task_change', '2026-10-07T10:00:01Z'),
      item('project_change', '2026-10-07T10:00:05Z'),
      item('task_change', '2026-10-07T09:59:59Z'),
      item('reminder', '2026-10-07T10:00:09Z'),
      item('digest', '2026-10-07T10:00:09Z', null, 'd'),
      item('task_change', '2026-10-07T10:00:07Z', '2026-10-07T10:00:08Z'),
    ], since);
    expect(picked.map((i) => i.id)).toEqual(['2026-10-07T10:00:05Z', '2026-10-07T10:00:01Z']);
  });

  it('accepts serialized dates', () => {
    expect(pickToasts([{ kind: 'task_change', createdAt: '2026-10-07T10:00:01Z', readAt: null }], since)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/unit/notifications.test.ts`
Expected: FAIL — `bellText` is not exported.

- [ ] **Step 3: Implement — append to `src/lib/notifications.ts`**

```ts
import {
  notificationHref, notificationText, type DigestData, type NotificationData, type ReminderData,
} from './reminders';

export type BellKind = 'reminder' | 'digest' | 'task_change' | 'project_change';
export type BellItem = { kind: BellKind; taskId: string | null; projectId: string | null; data: NotificationData };

export const MAX_TOASTS = 3;

const FIELD_LABELS: Record<TaskChangeKind, string> = {
  title: 'title', description: 'description', status: 'status', priority: 'priority', assignee: 'assignee',
  due_date: 'due date', labels: 'labels', attachment: 'attachments', comment: 'comment',
};

const PROJECT_VERBS: Record<ProjectChangeKind, string> = {
  renamed: 'renamed', archived: 'archived', unarchived: 'restored', deleted: 'deleted',
};

function taskDetail(d: TaskChangeData): string {
  const only = d.changes.length === 1 ? d.changes[0] : null;
  if (d.assignedToYou) return `${d.actorName} assigned you`;
  if (only === 'comment' && d.comment) return `${d.actorName} commented: “${d.comment}”`;
  if (only === 'status' && d.status) return `${d.actorName} moved to ${d.status}`;
  return `${d.actorName} changed ${d.changes.map((k) => FIELD_LABELS[k]).join(', ')}`;
}

function projectDetail(d: ProjectChangeData): string {
  if (d.changes.length > 1) return `${d.actorName} ${d.changes.map((k) => PROJECT_VERBS[k]).join(', ')}`;
  const [only] = d.changes;
  if (only === 'renamed') return `${d.actorName} renamed to ${d.newName ?? d.projectName}`;
  return `${d.actorName} ${PROJECT_VERBS[only]} this project`;
}

export function bellText(item: BellItem): { title: string; detail: string } {
  if (item.kind === 'task_change') {
    const d = item.data as TaskChangeData;
    return { title: d.title, detail: taskDetail(d) };
  }
  if (item.kind === 'project_change') {
    const d = item.data as ProjectChangeData;
    return { title: d.projectName, detail: projectDetail(d) };
  }
  return notificationText({ kind: item.kind, data: item.data as ReminderData | DigestData });
}

export function bellHref(slug: string, item: BellItem): string {
  if (item.kind === 'task_change') return item.taskId ? `/${slug}/tasks/${item.taskId}` : `/${slug}`;
  if (item.kind === 'project_change') {
    const d = item.data as ProjectChangeData;
    if (!item.projectId || d.changes.includes('deleted')) return `/${slug}`;
    if (d.changes.at(-1) === 'archived') return `/${slug}/settings/projects`;
    return `/${slug}/projects/${item.projectId}`;
  }
  return notificationHref(slug, { kind: item.kind, taskId: item.taskId });
}

const ms = (d: Date | string) => new Date(d).getTime();

/** Unread change items created after `since` (epoch ms), newest first. Reminders and digests never toast. */
export function pickToasts<T extends { kind: BellKind; readAt: Date | string | null; createdAt: Date | string }>(
  items: T[],
  since: number,
): T[] {
  return items
    .filter((i) => (i.kind === 'task_change' || i.kind === 'project_change') && !i.readAt && ms(i.createdAt) > since)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
}
```

Move the new `import` to the top of the file (imports first). `reminders.ts` imports only types from this file, so there is no runtime cycle.

- [ ] **Step 4: Run tests**

Run: `yarn test tests/unit/notifications.test.ts tests/unit/reminders.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts tests/unit/notifications.test.ts
git commit -m "feat(notifications): bell copy, links and toast selection for change items"
```

---

### Task 6: Email exclusion, bell query and bell list

**Files:**
- Modify: `src/server/reminders/run.ts` (claim query ~70), `src/server/notifications/queries.ts`, `src/components/shell/NotificationBell.tsx` (imports, list rendering)
- Test: `tests/server/reminder-run.test.ts` (append), `tests/server/notifications.test.ts` (append)

**Interfaces:**
- Consumes: `bellText`, `bellHref` (Task 5).
- Produces: `NotificationItem = { id; kind: 'reminder' | 'digest' | 'task_change' | 'project_change'; taskId: string | null; projectId: string | null; data: NotificationData; readAt: Date | null; createdAt: Date }`.

- [ ] **Step 1: Write failing tests**

`tests/server/reminder-run.test.ts`, in the `claimUnsentEmails` area (add `notification` and `newId` imports if missing):

```ts
  it('never claims change notifications', async () => {
    const { ctx, taskId } = await setup();
    await db.insert(notification).values({
      id: newId(), userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'task_change', taskId,
      dedupeKey: `chg:${newId()}`, data: { title: 'Ship', projectName: 'Website', actorName: 'Bob', changes: ['title'] },
    });
    expect(await claimUnsentEmails()).toEqual([]);
  });
```

(`setup()` only creates the reminder row; the cron has not run, so the only unsent row is the change row.)

`tests/server/notifications.test.ts`:

```ts
  it('lists change items with their project id', async () => {
    const { ada } = await setup();
    await db.insert(notification).values({
      id: newId(), userId: ada.userId, workspaceId: ada.workspaceId, kind: 'project_change', dedupeKey: `chg:${newId()}`,
      data: { projectName: 'Website', actorName: 'Bob', changes: ['deleted'] },
    });
    const [item] = await listNotifications(ada);
    expect(item).toMatchObject({ kind: 'project_change', projectId: null, taskId: null });
    expect(await unreadCount(ada)).toBe(1);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/server/reminder-run.test.ts tests/server/notifications.test.ts`
Expected: the claim test FAILS (one mail claimed, then the sender path may throw on an unknown kind); the list test FAILS (`projectId` undefined).

- [ ] **Step 3: Implement**

`src/server/reminders/run.ts` claim subquery, add after `WHERE email_sent_at IS NULL`:

```sql
        AND kind IN ('reminder', 'digest')
```

`src/server/notifications/queries.ts`:

```ts
export type NotificationItem = {
  id: string;
  kind: 'reminder' | 'digest' | 'task_change' | 'project_change';
  taskId: string | null;
  projectId: string | null;
  data: NotificationData;
  readAt: Date | null;
  createdAt: Date;
};
```

and add `projectId: notification.projectId,` to the select.

- [ ] **Step 4: Switch the bell list to the new helpers** — `src/components/shell/NotificationBell.tsx`

Replace `import { notificationHref, notificationText } from '@/lib/reminders';` with:

```ts
import { bellHref, bellText } from '@/lib/notifications';
```

and in the list: `const { title, detail } = bellText(item);` and `href={bellHref(workspaceSlug, item)}`.

- [ ] **Step 5: Run tests, typecheck**

Run: `yarn test tests/server/reminder-run.test.ts tests/server/notifications.test.ts tests/unit/notifications.test.ts && yarn typecheck`
Expected: pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/reminders/run.ts src/server/notifications/queries.ts src/components/shell/NotificationBell.tsx tests/server/reminder-run.test.ts tests/server/notifications.test.ts
git commit -m "feat(notifications): keep change notifications out of email and list them in the bell"
```

---

### Task 7: Bell toasts

**Files:**
- Modify: `src/components/shell/NotificationBell.tsx`

**Interfaces:**
- Consumes: `bellText`, `bellHref`, `pickToasts`, `MAX_TOASTS` (Task 5); `NotificationItem` (Task 6).

- [ ] **Step 1: Imports and doc comment**

Extend the notifications import to `import { bellHref, bellText, MAX_TOASTS, pickToasts } from '@/lib/notifications';`.

Update the component doc comment: replace "No realtime (roadmap slice 8)." with "When the count rises (a live refresh or the focus re-count), new change items also pop up as toasts."

- [ ] **Step 2: Add the toast effect**

Add imports: `useRef` from react, `useRouter` from `next/navigation`.

Inside the component, after the state declarations:

```tsx
  const router = useRouter();
  // Only what arrives after this tab opened toasts; the count it opened with does not.
  const lastToastAt = useRef(Date.now());
  const seenUnread = useRef(initialUnread);

  useEffect(() => {
    const rose = unread > seenUnread.current;
    seenUnread.current = unread;
    if (!rose) return;
    let cancelled = false;
    void (async () => {
      const result = await settle(listNotificationsAction(workspaceSlug));
      if (cancelled || !result.ok) return;
      setItems(result.data);
      const fresh = pickToasts(result.data, lastToastAt.current);
      if (fresh.length === 0) return;
      lastToastAt.current = new Date(fresh[0].createdAt).getTime();
      if (fresh.length > MAX_TOASTS) {
        toast(`${fresh.length} new updates`, { action: { label: 'View', onClick: () => setOpen(true) } });
        return;
      }
      for (const item of fresh) {
        const { title, detail } = bellText(item);
        toast(title, {
          description: detail,
          action: {
            label: 'Open',
            onClick: () => {
              setUnread((n) => Math.max(0, n - 1));
              void settle(markNotificationReadAction(workspaceSlug, item.id));
              router.push(bellHref(workspaceSlug, item));
            },
          },
        });
      }
    })();
    return () => { cancelled = true; };
  }, [unread, workspaceSlug, router]);
```

`fresh[0]` is the newest (pickToasts sorts newest first). "View" opens the popover; `items` is already fresh, so it shows without a second fetch (the existing `onOpenChange` still refetches when the user opens it by clicking).

Edge: the "View" toast sets `open` directly without calling `onOpenChange`, which is fine because `items` was just set.

- [ ] **Step 3: Lint and typecheck**

Run: `yarn lint src/components/shell/NotificationBell.tsx && yarn typecheck`
Expected: clean. If `react-hooks/set-state-in-effect` flags `setItems`, it should not (the call is after an `await` inside an async IIFE); if it does, keep the code and report it rather than disabling the rule.

- [ ] **Step 4: Manual check in the browser**

Run `yarn dev`, sign in as two users in two browsers (or one normal + one private window) in the same workspace. As user B, edit the title of a task user A created. In A's tab (focus it, or wait for Pusher), expect: bell badge +1 and a toast "<task title> — B changed title" with Open. Click Open → task page, badge back down.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/NotificationBell.tsx
git commit -m "feat(notifications): toast new change notifications from the bell"
```


---

### Task 8: Settings toggle

**Files:**
- Modify: `src/server/user-settings/service.ts:44-77`, `src/components/settings/ReminderPrefsForm.tsx`
- Test: `tests/server/user-settings.test.ts`

**Interfaces:**
- Produces: `ReminderPrefs = { reminderHour: number; digestEnabled: boolean; changeNotify: boolean }`; `updateReminderPrefs(ctx, input: { reminderHour: number; digestEnabled: boolean; changeNotify?: boolean })`.

- [ ] **Step 1: Update and add tests** in `tests/server/user-settings.test.ts`

- Line ~35: expected row gains `changeNotify: true`.
- Line ~70: `toEqual({ reminderHour: 9, digestEnabled: true, changeNotify: true })`.
- Line ~80: `toEqual({ reminderHour: 18, digestEnabled: false, changeNotify: true })`.
- New:

```ts
  it('turns change notifications off and keeps them off when omitted later', async () => {
    const ada = await createUser('us-cn@example.com', 'Ada');
    await updateReminderPrefs({ userId: ada.id }, { reminderHour: 9, digestEnabled: true, changeNotify: false });
    await updateReminderPrefs({ userId: ada.id }, { reminderHour: 10, digestEnabled: true });
    expect(await getReminderPrefs({ userId: ada.id })).toEqual({ reminderHour: 10, digestEnabled: true, changeNotify: false });
  });
```

(Match the file's existing helper for creating a user; adjust `createUser` import if it differs.)

- [ ] **Step 2: Run to see them fail**

Run: `yarn test tests/server/user-settings.test.ts`
Expected: FAIL on the missing `changeNotify`.

- [ ] **Step 3: Implement the service**

```ts
export type ReminderPrefs = { reminderHour: number; digestEnabled: boolean; changeNotify: boolean };

const reminderPrefsSchema = z.object({
  reminderHour: z.number().int().min(0).max(23),
  digestEnabled: z.boolean(),
  // Optional so older callers (the cron tests, the API) keep working; omitted = unchanged.
  changeNotify: z.boolean().optional(),
});
```

`getReminderPrefs`: select `changeNotify: userSettings.changeNotify` too; fallback `{ reminderHour: DEFAULT_REMINDER_HOUR, digestEnabled: true, changeNotify: true }`.

`updateReminderPrefs(ctx, input: Omit<ReminderPrefs, 'changeNotify'> & { changeNotify?: boolean })`: the existing insert/onConflictDoUpdate already spreads `parsed.data`; zod drops an absent optional key, so an omitted `changeNotify` is not written. Verify with the new test.

- [ ] **Step 4: The form** — `src/components/settings/ReminderPrefsForm.tsx`

Add state `const [changeNotify, setChangeNotify] = useState(current.changeNotify);`, include it in `unchanged` and in the action call `{ digestEnabled, reminderHour, changeNotify }`. Add above the digest row:

```tsx
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="change-notify">Changes by teammates</Label.Root>
          <Hint.Root>
            Bell and pop-up when someone changes a task you created or are assigned, or renames, archives or deletes a project.
          </Hint.Root>
        </div>
        <Switch.Root id="change-notify" checked={changeNotify} onCheckedChange={setChangeNotify} disabled={pending} />
      </div>
```

Change the success toast to `'Notification settings updated.'` (check `tests/e2e/preferences.spec.ts` for the old text first: `grep -n "Reminder settings updated" tests -r`; update any match).

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `yarn test tests/server/user-settings.test.ts tests/server/reminder-select.test.ts && yarn typecheck && yarn lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/user-settings/service.ts src/components/settings/ReminderPrefsForm.tsx tests/server/user-settings.test.ts tests/e2e/preferences.spec.ts
git commit -m "feat(notifications): let users turn change notifications off"
```

---

### Task 9: End-to-end and final verification

**Files:**
- Create: `tests/e2e/change-notifications.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Copy `stamp`, `signUp`, `addMember`, `twoMembers`, `refocus` from `tests/e2e/live-refresh.spec.ts` (same file-local style as there), then:

```ts
test("a teammate's edit to my task shows in my bell and as a toast", async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await createTask(page, 'Fix login');

  await bob.reload();
  await bob.getByRole('button', { name: 'Fix login', exact: true }).click();
  const theirs = bob.getByRole('dialog', { name: 'Task details' });
  await theirs.getByLabel('Title').fill('Fix login on Safari');
  await theirs.getByLabel('Title').blur();
  await bob.keyboard.press('Escape');
  await expect(bob.getByRole('button', { name: 'Fix login on Safari', exact: true })).toBeVisible();

  await refocus(page);
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await expect(page.getByText('Bob changed title')).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('renaming a project tells the other members', async ({ page, browser }) => {
  const { bob } = await twoMembers(page, browser);
  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel('Project name').fill('Marketing site');
  await page.getByRole('button', { name: 'Save' }).click();

  await refocus(bob);
  await expect(bob.getByText('Ada renamed to Marketing site')).toBeVisible();
});
```

If the Bob page's toast does not appear after `refocus`, confirm `LiveRefresh` polls on focus (it does in the existing live-refresh spec) and that the bell's server count arrives via the refreshed layout.

- [ ] **Step 2: Run e2e**

Run: `yarn e2e tests/e2e/change-notifications.spec.ts tests/e2e/live-refresh.spec.ts tests/e2e/preferences.spec.ts tests/e2e/reminders.spec.ts`
Expected: pass.

- [ ] **Step 3: Full verification**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all clean/green. Report failures verbatim; do not mark done otherwise.

- [ ] **Step 4: Refresh the graph and commit**

```bash
graphify update .
git add tests/e2e/change-notifications.spec.ts
git commit -m "test(notifications): end-to-end change notifications"
```

(Commit `graphify-out/` only if it is tracked: `git ls-files graphify-out | head -1`.)

- [ ] **Step 5: Production note for the user**

Tell the user the schema must be pushed to develop/prod before deploy: `yarn db:setup:dev` / `yarn db:setup:prod` (adds enum values, two columns, two partial unique indexes, `user_settings.change_notify`; non-destructive). Do not run these yourself.
