# Comment Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members react to task comments with one of six fixed emoji; counts, own state and reactor names show on every comment; the comment's author gets a bell item.

**Architecture:** New `comment_reaction` table (PK comment+user+emoji). A `toggleReaction` service inserts-or-deletes in one transaction, bumps the live-refresh stamp and, on add, notifies the comment author through `notifyTaskChange` with a new `recipients` override and a `reaction` change kind. `listTaskFeed` attaches grouped reactions to comment entries; the REST comment shape exposes them read-only; a `CommentReactions` client component renders chips + a popover picker with reducer-style `useOptimistic`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19.3, Drizzle 0.45 on Postgres, Zod 4, Align UI (Radix Popover/Tooltip), Tabler icons, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-comment-reactions-design.md`

## Global Constraints

- Emoji set, in this order: `['👍', '❤️', '🎉', '😄', '👀', '🚀']`. Nothing else accepted.
- `emoji` column is plain `text`, not a pg enum.
- `user_id` always comes from `ctx`, never from input.
- Only an *added* reaction notifies; only the comment's author; never the actor; never when the author has `change_notify = false` or is no longer a member.
- REST API: read-only `reactions: [{ emoji, count, userIds }]` on the comment shape; no new routes.
- No migrations in this project: schema lands via `drizzle-kit push` (`yarn db:setup`, `yarn db:setup:test`; prod `yarn db:setup:prod`).
- Error copy: `'Unknown reaction.'`, `'Comment not found.'`.
- Notification copy (reaction alone): `${actorName} reacted ${emoji} to your comment: “${excerpt}”`.
- Commits: plain messages, **no `Co-Authored-By` trailer**. Do not bump the package version.
- After code changes: `graphify update .`.

## Review Focus

1. **Rapid repeated clicks on a chip** — each click must toggle relative to the previous optimistic state, not the stale server prop. Pinned by `applyToggle` unit tests (Task 4) + reducer-form `useOptimistic` (Task 6).
2. **Author who has left the workspace** — reaction succeeds, no notification row. Pinned in Task 3.
3. **Same actor reacts several times before the author reads** — one unread bell item whose text shows the latest emoji. Pinned in Task 3.
4. **Heart without the variation selector (`'❤'` vs `'❤️'`)** — rejected as `Unknown reaction.`, never stored as a seventh emoji. Pinned in Task 3.
5. **Comment on an archived project** — toggle refused with `Comment not found.`; reactions already there still render in the feed. Pinned in Task 3 and Task 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/reactions.ts` (new) | Emoji set, `CommentReaction` type, pure helpers: `groupReactions`, `applyToggle`, `reactorsLabel` |
| `src/db/schema/activity.ts` | `commentReaction` table |
| `tests/setup/db.ts` | add `comment_reaction` to TRUNCATE |
| `src/lib/notifications.ts` | `reaction` kind, data field, bell text |
| `src/server/notifications/changes.ts` | `recipients` override, `reaction` payload, keep stored reaction |
| `src/server/comments/reactions.ts` (new) | `toggleReaction` service |
| `src/server/comments/actions.ts` | `toggleReactionAction` |
| `src/server/activity/queries.ts` | reactions on comment feed entries |
| `src/server/api/contract/shapes.ts`, `src/server/api/serialize.ts` | REST read shape |
| `src/components/task/CommentReactions.tsx` (new) | chips + picker UI |
| `src/components/task/ActivityFeed.tsx` | render `CommentReactions` |

---

### Task 1: Schema + emoji set

**Files:**
- Create: `src/lib/reactions.ts`
- Modify: `src/db/schema/activity.ts`
- Modify: `tests/setup/db.ts:9-16`
- Test: `tests/server/schema.test.ts`

**Interfaces:**
- Produces: `REACTION_EMOJIS`, `type ReactionEmoji`, `isReactionEmoji(value: string): value is ReactionEmoji` from `@/lib/reactions`; `commentReaction` table from `@/db` with columns `commentId, workspaceId, userId, emoji, createdAt`.

- [ ] **Step 1: Write the failing schema tests**

Append to `tests/server/schema.test.ts` (add `commentReaction` to the `@/db` import):

```ts
describe('comment_reaction', () => {
  async function seedComment() {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();
    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'T', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });
    const commentId = newId();
    await db.insert(comment).values({ id: commentId, workspaceId, taskId, authorId: userId, body: 'Hi' });
    return { userId, workspaceId, commentId };
  }

  it('allows one row per comment, user and emoji', async () => {
    const { userId, workspaceId, commentId } = await seedComment();
    const row = { commentId, workspaceId, userId, emoji: '👍' };
    await db.insert(commentReaction).values(row);
    await db.insert(commentReaction).values({ ...row, emoji: '🎉' });
    await expect(db.insert(commentReaction).values(row)).rejects.toThrow();
  });

  it('goes with the comment and with the reacting user', async () => {
    const { userId, workspaceId, commentId } = await seedComment();
    await db.insert(commentReaction).values({ commentId, workspaceId, userId, emoji: '👍' });
    await db.delete(comment);
    expect(await db.select().from(commentReaction)).toHaveLength(0);

    const again = await seedComment();
    await db.insert(commentReaction).values({ ...again, emoji: '👍' });
    await db.delete(user).where(sql`${user.id} = ${again.userId}`);
    expect(await db.select().from(commentReaction)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/server/schema.test.ts`
Expected: FAIL — `commentReaction` is not exported from `@/db`.

- [ ] **Step 3: Create `src/lib/reactions.ts`**

```ts
/**
 * Comment reactions: the fixed emoji set and pure helpers shared by the server,
 * the feed and the UI.
 */

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '👀', '🚀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Add the table to `src/db/schema/activity.ts`**

Change the drizzle import to `import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';` and append after `comment`:

```ts
export const commentReaction = pgTable(
  'comment_reaction',
  {
    commentId: text('comment_id').notNull().references(() => comment.id, { onDelete: 'cascade' }),
    // Denormalized like comment.workspace_id: the tenancy filter is one predicate.
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    // Cascade, not set null: a reaction says nothing once its person is gone.
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // Plain text like task_activity.kind; validated against REACTION_EMOJIS.
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })],
);
```

- [ ] **Step 5: Add `comment_reaction` to `resetDb`**

In `tests/setup/db.ts`, change `attachment, todo, project_star, comment, task_activity,` to `attachment, todo, project_star, comment_reaction, comment, task_activity,`.

- [ ] **Step 6: Push the schema to dev and test DBs**

Run: `yarn db:setup && yarn db:setup:test`
Expected: drizzle-kit reports `CREATE TABLE "comment_reaction"`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn vitest run tests/server/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/reactions.ts src/db/schema/activity.ts tests/setup/db.ts tests/server/schema.test.ts
git commit -m "feat(reactions): comment_reaction table and emoji set"
```

---

### Task 2: `reaction` change kind + author-only recipients

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/server/notifications/changes.ts:70-130`
- Test: `tests/unit/notifications.test.ts`, `tests/server/change-notifications.test.ts`

**Interfaces:**
- Produces: `TaskChangeKind` includes `'reaction'`; `TaskChangeData.reaction?: { emoji: string; comment: string }`; `notifyTaskChange(ctx, tx, { taskId, changes, recipients?: string[], reaction?: { emoji: string; comment: string }, ... })`.

- [ ] **Step 1: Write the failing unit test**

In `tests/unit/notifications.test.ts`, inside `describe('bellText')` → `it('describes task changes')`, add:

```ts
    expect(bellText(task({ changes: ['reaction'], reaction: { emoji: '🎉', comment: 'Shipped' } })).detail)
      .toBe('Anna reacted 🎉 to your comment: “Shipped”');
    expect(bellText(task({ changes: ['title', 'reaction'], reaction: { emoji: '🎉', comment: 'Shipped' } })).detail)
      .toBe('Anna changed title, reaction');
```

- [ ] **Step 2: Write the failing server tests**

Append to `tests/server/change-notifications.test.ts` inside `describe('notifyTaskChange')`:

```ts
  it('notifies only the given recipients when they are passed', async () => {
    const { ada, bob, taskId } = await setup();
    const carol = await createUser('cn-carol@example.com', 'Carol');
    await joinWorkspace(carol.id, ada.workspaceId, 'member');
    await db.transaction((tx) => notifyTaskChange(bob, tx, {
      taskId, changes: ['reaction'], recipients: [carol.id], reaction: { emoji: '👍', comment: 'Hi' },
    }));
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row.userId).toBe(carol.id);
    expect(row.data).toMatchObject({ changes: ['reaction'], reaction: { emoji: '👍', comment: 'Hi' } });
  });

  it('keeps the stored reaction when a later change carries none', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, {
      taskId, changes: ['reaction'], recipients: [ada.userId], reaction: { emoji: '👍', comment: 'Hi' },
    }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row.data).toMatchObject({ changes: ['reaction', 'title'], reaction: { emoji: '👍', comment: 'Hi' } });
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `yarn vitest run tests/unit/notifications.test.ts tests/server/change-notifications.test.ts`
Expected: FAIL — type errors / wrong recipient / detail text mismatch.

- [ ] **Step 4: Extend `src/lib/notifications.ts`**

```ts
export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment', 'reaction',
] as const;
```

In `TaskChangeData`, after `comment?: string;`:

```ts
  /** Latest reaction and the excerpt of the comment it is on, when 'reaction' is among changes. */
  reaction?: { emoji: string; comment: string };
```

In `FIELD_LABELS` add `reaction: 'reaction'`. In `taskDetail`, after the `comment` line:

```ts
  if (only === 'reaction' && d.reaction) {
    return `${d.actorName} reacted ${d.reaction.emoji} to your comment: “${d.reaction.comment}”`;
  }
```

- [ ] **Step 5: Extend `notifyTaskChange` in `src/server/notifications/changes.ts`**

Input type, after `comment?: string;`:

```ts
    /** Replaces the involved set (assignee, creator, previous assignee). The member/actor/opt-out filter still applies. */
    recipients?: string[];
    reaction?: { emoji: string; comment: string };
```

Replace `const ids = await recipients(ctx, tx, [...new Set(involved)]);` with:

```ts
  const ids = await recipients(ctx, tx, [...new Set(input.recipients ?? involved)]);
```

In `dataFor`, after the `comment` spread:

```ts
    ...(input.reaction ? { reaction: input.reaction } : {}),
```

In the `DO UPDATE SET data = …` chain, after `|| ${keepStored('status')},` change to:

```ts
        || ${keepStored('status')}
        || ${keepStored('reaction')},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run tests/unit/notifications.test.ts tests/server/change-notifications.test.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications.ts src/server/notifications/changes.ts tests/unit/notifications.test.ts tests/server/change-notifications.test.ts
git commit -m "feat(reactions): reaction change kind and recipient override"
```

---

### Task 3: `toggleReaction` service + action

**Files:**
- Create: `src/server/comments/reactions.ts`
- Modify: `src/server/comments/actions.ts`
- Test: `tests/server/comment-reactions.test.ts` (new)

**Interfaces:**
- Consumes: `commentReaction` (Task 1), `REACTION_EMOJIS` (Task 1), `notifyTaskChange` with `recipients`/`reaction` (Task 2), `commentExcerpt` from `@/server/notifications/changes`.
- Produces: `toggleReaction(ctx: WorkspaceContext, input: { commentId: string; emoji: string }): Promise<Result<{ reacted: boolean }>>`; `toggleReactionAction(workspaceSlug: string, input: { commentId: string; emoji: string }): Promise<Result<{ reacted: boolean }>>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/comment-reactions.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { commentReaction, member, notification, userSettings, workspaceChange } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { createComment } from '@/server/comments/service';
import { toggleReaction } from '@/server/comments/reactions';
import { archiveProject, createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
});

/** Ada owns the workspace and wrote a comment on her task; Bob is a member. */
async function setup(slug = 'ws-rx') {
  const adaUser = await createUser(`${slug}-ada@example.com`, 'Ada');
  const bobUser = await createUser(`${slug}-bob@example.com`, 'Bob');
  const ws = await createWorkspace(adaUser.id, 'Acme', slug);
  await joinWorkspace(bobUser.id, ws.id, 'member');
  const ada = ctxFor(adaUser.id, ws);
  const bob = ctxFor(bobUser.id, ws, 'member');
  const project = await createProject(ada, { name: 'Website' });
  if (!project.ok) throw new Error('setup');
  const made = await createTask(ada, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error('setup');
  const posted = await createComment(ada, { taskId: made.data.id, body: 'Shipped it' });
  if (!posted.ok) throw new Error('setup');
  // createComment notified nobody (Ada is creator and actor), but clear to be safe.
  await db.delete(notification);
  return { ws, ada, bob, projectId: project.data.id, taskId: made.data.id, commentId: posted.data.id };
}

const reactions = () => db.select().from(commentReaction);
const notes = () => db.select().from(notification);

describe('toggleReaction', () => {
  it('adds on the first toggle and removes on the second', async () => {
    const { bob, commentId } = await setup();

    expect(await toggleReaction(bob, { commentId, emoji: '👍' })).toEqual({ ok: true, data: { reacted: true } });
    expect(await reactions()).toEqual([expect.objectContaining({ commentId, userId: bob.userId, emoji: '👍', workspaceId: bob.workspaceId })]);

    expect(await toggleReaction(bob, { commentId, emoji: '👍' })).toEqual({ ok: true, data: { reacted: false } });
    expect(await reactions()).toHaveLength(0);
  });

  it('lets one person add several different emoji', async () => {
    const { bob, commentId } = await setup();
    await toggleReaction(bob, { commentId, emoji: '👍' });
    await toggleReaction(bob, { commentId, emoji: '🚀' });
    expect((await reactions()).map((r) => r.emoji).sort()).toEqual(['👍', '🚀'].sort());
  });

  // Review Focus 4.
  it('rejects an emoji outside the set, including a bare heart', async () => {
    const { bob, commentId } = await setup();
    expect(await toggleReaction(bob, { commentId, emoji: '💩' })).toEqual({ ok: false, error: 'Unknown reaction.' });
    expect(await toggleReaction(bob, { commentId, emoji: '❤' })).toEqual({ ok: false, error: 'Unknown reaction.' });
    expect(await reactions()).toHaveLength(0);
  });

  it('refuses a comment in another workspace', async () => {
    const a = await setup('ws-rx-a');
    const b = await setup('ws-rx-b');
    expect(await toggleReaction(b.bob, { commentId: a.commentId, emoji: '👍' })).toEqual({ ok: false, error: 'Comment not found.' });
    expect(await reactions()).toHaveLength(0);
  });

  // Review Focus 5.
  it('refuses a comment on an archived project', async () => {
    const { ada, bob, projectId, commentId } = await setup();
    const archived = await archiveProject(ada, { projectId });
    expect(archived.ok).toBe(true);
    expect(await toggleReaction(bob, { commentId, emoji: '👍' })).toEqual({ ok: false, error: 'Comment not found.' });
  });

  it('bumps the workspace change stamp', async () => {
    const { bob, commentId } = await setup();
    const before = (await db.select().from(workspaceChange))[0]?.version ?? 0;
    await toggleReaction(bob, { commentId, emoji: '👍' });
    const [after] = await db.select().from(workspaceChange).where(eq(workspaceChange.workspaceId, bob.workspaceId));
    expect(after.version).toBeGreaterThan(before);
  });
});

describe('toggleReaction notifications', () => {
  it('tells the comment author once, with the emoji and an excerpt', async () => {
    const { ada, bob, commentId } = await setup();
    await toggleReaction(bob, { commentId, emoji: '🎉' });
    const [row, ...rest] = await notes();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: ada.userId, actorId: bob.userId, kind: 'task_change' });
    expect(row.data).toMatchObject({ changes: ['reaction'], reaction: { emoji: '🎉', comment: 'Shipped it' } });
  });

  // Review Focus 3.
  it('merges repeated reactions by one person into one unread item showing the latest', async () => {
    const { bob, commentId } = await setup();
    await toggleReaction(bob, { commentId, emoji: '👍' });
    await toggleReaction(bob, { commentId, emoji: '🚀' });
    const [row, ...rest] = await notes();
    expect(rest).toHaveLength(0);
    expect(row.data).toMatchObject({ changes: ['reaction'], reaction: { emoji: '🚀' } });
  });

  it('does not notify on removal', async () => {
    const { bob, commentId } = await setup();
    await toggleReaction(bob, { commentId, emoji: '👍' });
    await db.delete(notification);
    await toggleReaction(bob, { commentId, emoji: '👍' });
    expect(await notes()).toHaveLength(0);
  });

  it('does not notify someone reacting to their own comment', async () => {
    const { ada, commentId } = await setup();
    await toggleReaction(ada, { commentId, emoji: '👍' });
    expect(await notes()).toHaveLength(0);
  });

  it('respects the author turning change notifications off', async () => {
    const { ada, bob, commentId } = await setup();
    await db.insert(userSettings).values({ userId: ada.userId, changeNotify: false })
      .onConflictDoUpdate({ target: userSettings.userId, set: { changeNotify: false } });
    await toggleReaction(bob, { commentId, emoji: '👍' });
    expect(await notes()).toHaveLength(0);
  });

  // Review Focus 2.
  it('reacts but notifies nobody when the author has left the workspace', async () => {
    const { ada, bob, commentId } = await setup();
    await db.delete(member).where(eq(member.userId, ada.userId));
    expect((await toggleReaction(bob, { commentId, emoji: '👍' })).ok).toBe(true);
    expect(await reactions()).toHaveLength(1);
    expect(await notes()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run tests/server/comment-reactions.test.ts`
Expected: FAIL — cannot resolve `@/server/comments/reactions`.

- [ ] **Step 3: Implement `src/server/comments/reactions.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { comment, commentReaction, db, project, task } from '@/db';
import { REACTION_EMOJIS } from '@/lib/reactions';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { emitChange } from '@/server/changes/service';
import { commentExcerpt, notifyTaskChange } from '@/server/notifications/changes';

const toggleSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.enum(REACTION_EMOJIS, { error: 'Unknown reaction.' }),
});

/**
 * Adds the caller's reaction, or takes it back if it is already there. Only an
 * add notifies, and only the comment's author: a reaction is a nod, not news
 * for everyone on the task.
 */
export async function toggleReaction(
  ctx: WorkspaceContext,
  input: { commentId: string; emoji: string },
): Promise<Result<{ reacted: boolean }>> {
  return withAction(async () => {
    const parsed = toggleSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);
    const { commentId, emoji } = parsed.data;

    // Same gate as createComment: an archived project's thread is read-only.
    const [target] = await db
      .select({ authorId: comment.authorId, taskId: comment.taskId, body: comment.body })
      .from(comment)
      .innerJoin(task, eq(task.id, comment.taskId))
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(comment.id, commentId), eq(comment.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!target) return err('Comment not found.');

    const reacted = await db.transaction(async (tx) => {
      const added = await tx
        .insert(commentReaction)
        // From the context, never the input.
        .values({ commentId, workspaceId: ctx.workspaceId, userId: ctx.userId, emoji })
        .onConflictDoNothing()
        .returning({ emoji: commentReaction.emoji });

      if (added.length === 0) {
        await tx.delete(commentReaction).where(and(
          eq(commentReaction.commentId, commentId),
          eq(commentReaction.userId, ctx.userId),
          eq(commentReaction.emoji, emoji),
        ));
      } else if (target.authorId && target.authorId !== ctx.userId) {
        await notifyTaskChange(ctx, tx, {
          taskId: target.taskId,
          changes: ['reaction'],
          recipients: [target.authorId],
          reaction: { emoji, comment: commentExcerpt(target.body) },
        });
      }
      await emitChange(ctx, {}, tx);
      return added.length > 0;
    });

    return ok({ reacted });
  });
}
```

- [ ] **Step 4: Add the action to `src/server/comments/actions.ts`**

Add the import `import { toggleReaction } from './reactions';` and append:

```ts
export async function toggleReactionAction(
  workspaceSlug: string,
  input: { commentId: string; emoji: string },
): Promise<Result<{ reacted: boolean }>> {
  return withAction(async () => {
    const result = await toggleReaction(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run tests/server/comment-reactions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/comments/reactions.ts src/server/comments/actions.ts tests/server/comment-reactions.test.ts
git commit -m "feat(reactions): toggle a reaction, notify the comment author"
```

---

### Task 4: Reactions in the task feed

**Files:**
- Modify: `src/lib/reactions.ts`
- Modify: `src/server/activity/queries.ts`
- Test: `tests/unit/reactions.test.ts` (new), `tests/server/feed.test.ts`

**Interfaces:**
- Consumes: `commentReaction`, `REACTION_EMOJIS`, `isReactionEmoji` (Task 1); `toggleReaction` (Task 3, in tests).
- Produces:
  - `type CommentReaction = { emoji: ReactionEmoji; count: number; reactedByMe: boolean; userIds: string[]; names: string[] }`
  - `groupReactions(rows: { commentId: string; emoji: string; userId: string; name: string }[], currentUserId: string): Map<string, CommentReaction[]>`
  - `applyToggle(reactions: CommentReaction[], emoji: ReactionEmoji, currentUserId: string): CommentReaction[]`
  - `reactorsLabel(reaction: CommentReaction, currentUserId: string): string`
  - `FeedEntry` comment variant gains `reactions: CommentReaction[]`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/reactions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyToggle, groupReactions, reactorsLabel, type CommentReaction } from '@/lib/reactions';

const row = (commentId: string, emoji: string, userId: string, name: string) => ({ commentId, emoji, userId, name });

describe('groupReactions', () => {
  it('groups per comment in emoji-set order, counting people in reaction order', () => {
    const map = groupReactions([
      row('c1', '🚀', 'u2', 'Bob'),
      row('c1', '👍', 'u2', 'Bob'),
      row('c1', '👍', 'u1', 'Ada'),
      row('c2', '🎉', 'u3', 'Cy'),
    ], 'u1');
    expect(map.get('c1')).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u2', 'u1'], names: ['Bob', 'Ada'] },
      { emoji: '🚀', count: 1, reactedByMe: false, userIds: ['u2'], names: ['Bob'] },
    ]);
    expect(map.get('c2')).toEqual([{ emoji: '🎉', count: 1, reactedByMe: false, userIds: ['u3'], names: ['Cy'] }]);
  });

  it('drops emoji this build does not know', () => {
    expect(groupReactions([row('c1', '💩', 'u1', 'Ada')], 'u1').get('c1')).toBeUndefined();
  });
});

describe('applyToggle', () => {
  const thumbs: CommentReaction = { emoji: '👍', count: 1, reactedByMe: false, userIds: ['u2'], names: ['Bob'] };

  it('adds me to an existing chip', () => {
    expect(applyToggle([thumbs], '👍', 'u1')).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u2', 'u1'], names: ['Bob', 'You'] },
    ]);
  });

  it('creates a chip in emoji-set order', () => {
    expect(applyToggle([thumbs], '🚀', 'u1').map((r) => r.emoji)).toEqual(['👍', '🚀']);
    expect(applyToggle([{ ...thumbs, emoji: '🚀' }], '👍', 'u1').map((r) => r.emoji)).toEqual(['👍', '🚀']);
  });

  it('removes me, and the chip at zero', () => {
    const mine: CommentReaction = { emoji: '👍', count: 1, reactedByMe: true, userIds: ['u1'], names: ['Ada'] };
    expect(applyToggle([mine], '👍', 'u1')).toEqual([]);
  });

  // Review Focus 1: each click toggles relative to the last optimistic state.
  it('composes: two toggles of the same emoji cancel out', () => {
    expect(applyToggle(applyToggle([thumbs], '👍', 'u1'), '👍', 'u1')).toEqual([thumbs]);
  });
});

describe('reactorsLabel', () => {
  const r = (userIds: string[], names: string[]): CommentReaction =>
    ({ emoji: '👍', count: userIds.length, reactedByMe: userIds.includes('me'), userIds, names });

  it('names up to two, then counts the rest, calling me You', () => {
    expect(reactorsLabel(r(['a'], ['Ana']), 'me')).toBe('Ana');
    expect(reactorsLabel(r(['a', 'me'], ['Ana', 'Lev']), 'me')).toBe('Ana and You');
    expect(reactorsLabel(r(['a', 'b', 'c'], ['Ana', 'Ben', 'Cy']), 'me')).toBe('Ana, Ben and 1 other');
    expect(reactorsLabel(r(['a', 'b', 'c', 'd'], ['Ana', 'Ben', 'Cy', 'Di']), 'me')).toBe('Ana, Ben and 2 others');
  });
});
```

- [ ] **Step 2: Write the failing feed test**

In `tests/server/feed.test.ts`: import `toggleReaction` from `@/server/comments/reactions` and `archiveProject` from `@/server/projects/service` (alongside `createProject`); change the `setup` helper's last line to `return { ctx, taskId: madeTask.data.id, projectId: created.data.id };`. Then append inside `describe('listTaskFeed')`:

```ts
  it('attaches reactions to comment entries', async () => {
    const { ctx, taskId } = await setup('feed-rx@example.com', 'ws-feed-rx');
    const posted = await createComment(ctx, { taskId, body: 'React to me' });
    if (!posted.ok) throw new Error('setup');
    await toggleReaction(ctx, { commentId: posted.data.id, emoji: '🎉' });

    const entry = (await listTaskFeed(ctx, taskId)).find((e) => e.type === 'comment')!;

    expect(entry).toMatchObject({
      reactions: [{ emoji: '🎉', count: 1, reactedByMe: true, userIds: [ctx.userId], names: ['Ada'] }],
    });
  });

  // Review Focus 5: the thread is read-only once archived, but reactions still show.
  it('still shows reactions after the project is archived', async () => {
    const { ctx, taskId, projectId } = await setup('feed-rx2@example.com', 'ws-feed-rx2');
    const posted = await createComment(ctx, { taskId, body: 'Old news' });
    if (!posted.ok) throw new Error('setup');
    await toggleReaction(ctx, { commentId: posted.data.id, emoji: '👀' });
    await archiveProject(ctx, { projectId });

    const entry = (await listTaskFeed(ctx, taskId)).find((e) => e.type === 'comment')!;
    expect(entry).toMatchObject({ reactions: [{ emoji: '👀', count: 1 }] });
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `yarn vitest run tests/unit/reactions.test.ts tests/server/feed.test.ts`
Expected: FAIL — `groupReactions` not exported; feed entries have no `reactions`.

- [ ] **Step 4: Add the helpers to `src/lib/reactions.ts`**

```ts
export type CommentReaction = {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
  /** In reaction order; parallel to names. */
  userIds: string[];
  names: string[];
};

const order = (emoji: ReactionEmoji) => REACTION_EMOJIS.indexOf(emoji);
const byEmoji = (a: CommentReaction, b: CommentReaction) => order(a.emoji) - order(b.emoji);

/** Reaction rows (oldest first) into each comment's chips, in emoji-set order. */
export function groupReactions(
  rows: { commentId: string; emoji: string; userId: string; name: string }[],
  currentUserId: string,
): Map<string, CommentReaction[]> {
  const byComment = new Map<string, Map<ReactionEmoji, CommentReaction>>();
  for (const r of rows) {
    // A kind written by another deploy that this build does not know is dropped.
    if (!isReactionEmoji(r.emoji)) continue;
    const chips = byComment.get(r.commentId) ?? new Map<ReactionEmoji, CommentReaction>();
    byComment.set(r.commentId, chips);
    const chip = chips.get(r.emoji) ?? { emoji: r.emoji, count: 0, reactedByMe: false, userIds: [], names: [] };
    chips.set(r.emoji, chip);
    chip.count += 1;
    chip.userIds.push(r.userId);
    chip.names.push(r.name);
    if (r.userId === currentUserId) chip.reactedByMe = true;
  }
  return new Map([...byComment].map(([id, chips]) => [id, [...chips.values()].sort(byEmoji)]));
}

/** The chips after I toggle `emoji`: the optimistic step, so it must compose. */
export function applyToggle(
  reactions: CommentReaction[],
  emoji: ReactionEmoji,
  currentUserId: string,
): CommentReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) {
    return [...reactions, { emoji, count: 1, reactedByMe: true, userIds: [currentUserId], names: ['You'] }].sort(byEmoji);
  }
  if (existing.reactedByMe) {
    const keep = existing.userIds.map((id, i) => id !== currentUserId ? i : -1).filter((i) => i >= 0);
    if (keep.length === 0) return reactions.filter((r) => r !== existing);
    const next: CommentReaction = {
      emoji, count: keep.length, reactedByMe: false,
      userIds: keep.map((i) => existing.userIds[i]), names: keep.map((i) => existing.names[i]),
    };
    return reactions.map((r) => (r === existing ? next : r));
  }
  const next: CommentReaction = {
    emoji, count: existing.count + 1, reactedByMe: true,
    userIds: [...existing.userIds, currentUserId], names: [...existing.names, 'You'],
  };
  return reactions.map((r) => (r === existing ? next : r));
}

/** Tooltip text: "Ana", "Ana and You", "Ana, Ben and 2 others". */
export function reactorsLabel(reaction: CommentReaction, currentUserId: string): string {
  const names = reaction.names.map((name, i) => (reaction.userIds[i] === currentUserId ? 'You' : name));
  if (names.length <= 2) return names.join(' and ');
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}
```

- [ ] **Step 5: Wire it into `src/server/activity/queries.ts`**

Imports:

```ts
import { comment, commentReaction, db, taskActivity, user } from '@/db';
import { groupReactions, type CommentReaction } from '@/lib/reactions';
```

In `FeedEntry`'s comment variant, after `editedAt: Date | null;`:

```ts
      /** Chips in emoji-set order; empty when nobody has reacted. */
      reactions: CommentReaction[];
```

Change `const [comments, activity] = await Promise.all([` to `const [comments, activity, reactionRows] = await Promise.all([` and add a third query after the activity one:

```ts
    db
      .select({
        commentId: commentReaction.commentId,
        emoji: commentReaction.emoji,
        userId: commentReaction.userId,
        name: user.name,
      })
      .from(commentReaction)
      .innerJoin(comment, eq(comment.id, commentReaction.commentId))
      .innerJoin(user, eq(user.id, commentReaction.userId))
      .where(and(eq(comment.taskId, taskId), eq(commentReaction.workspaceId, ctx.workspaceId)))
      .orderBy(asc(commentReaction.createdAt), asc(commentReaction.userId)),
```

Before `const entries`, add `const reactions = groupReactions(reactionRows, ctx.userId);` and in the comments map:

```ts
    ...comments.map((c) => ({
      type: 'comment' as const,
      ...c,
      authorName: c.authorName ?? DELETED_USER,
      reactions: reactions.get(c.id) ?? [],
    })),
```

Update the doc comment above `listTaskFeed` from "Two indexed reads" to "Indexed reads (comments, their reactions, activity)".

- [ ] **Step 6: Run tests and typecheck**

Run: `yarn vitest run tests/unit/reactions.test.ts tests/server/feed.test.ts && yarn typecheck`
Expected: PASS; typecheck clean (`ActivityFeed` only reads entries, so no change needed there yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/reactions.ts src/server/activity/queries.ts tests/unit/reactions.test.ts tests/server/feed.test.ts
git commit -m "feat(reactions): reactions on comment feed entries"
```

---

### Task 5: REST API read shape

**Files:**
- Modify: `src/server/api/contract/shapes.ts:63-69`
- Modify: `src/server/api/serialize.ts:56-65`
- Test: `tests/server/api-v1-comments.test.ts`, `tests/unit/openapi.test.ts`

**Interfaces:**
- Consumes: `FeedEntry.reactions` (Task 4), `toggleReaction` (Task 3).
- Produces: `ApiComment.reactions: { emoji: string; count: number; userIds: string[] }[]`.

- [ ] **Step 1: Update/write the failing tests**

In `tests/server/api-v1-comments.test.ts`, the first POST test's `toEqual` gains `reactions: []`:

```ts
    expect(res.json).toEqual({
      id: expect.any(String), author: { id: f.ada.id, name: 'Ada' }, body: 'Looks good',
      createdAt: expect.stringMatching(/Z$/), editedAt: null, reactions: [],
    });
```

Add inside `describe('GET comments')` (import `toggleReaction` from `@/server/comments/reactions`):

```ts
  it('lists reactions with counts and user ids', async () => {
    const f = await withTask('m-rx');
    const made = await post(f, { body: 'React' });
    await toggleReaction(f.ctx, { commentId: made.json.id, emoji: '👍' });

    const res = await get(f);

    expect(res.json.data[0].reactions).toEqual([{ emoji: '👍', count: 1, userIds: [f.ada.id] }]);
  });
```

In `tests/unit/openapi.test.ts`, add inside the top-level describe:

```ts
  it('documents reactions on comments', () => {
    const list = doc.paths['/workspaces/{slug}/tasks/{taskId}/comments'].get.responses['200'];
    expect(JSON.stringify(list)).toContain('"reactions"');
  });
```

> If the 200 response references a component (`$ref`), stringify `doc` instead of `list` and assert `"reactions"` plus `"userIds"` both appear.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run tests/server/api-v1-comments.test.ts tests/unit/openapi.test.ts`
Expected: FAIL — no `reactions` in the response or the document.

- [ ] **Step 3: Extend `commentShape`**

```ts
export const commentShape = z.object({
  id: z.string(),
  author: personRef.nullable().describe('Null once the author has deleted their account.'),
  body: z.string().describe('Markdown.'),
  createdAt: iso(),
  editedAt: iso().nullable(),
  reactions: z.array(z.object({
    emoji: z.string().describe('One of 👍 ❤️ 🎉 😄 👀 🚀.'),
    count: z.number().int(),
    userIds: z.array(z.string()).describe('Who reacted, oldest first.'),
  })).describe('Read-only. In a fixed emoji order; empty when nobody has reacted.'),
});
```

- [ ] **Step 4: Map it in `serializeComment`**

After the `editedAt` line:

```ts
    reactions: c.reactions.map((r) => ({ emoji: r.emoji, count: r.count, userIds: r.userIds })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run tests/server/api-v1-comments.test.ts tests/unit/openapi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/api/contract/shapes.ts src/server/api/serialize.ts tests/server/api-v1-comments.test.ts tests/unit/openapi.test.ts
git commit -m "feat(api): expose comment reactions read-only"
```

---

### Task 6: Reaction chips and picker

**Files:**
- Create: `src/components/task/CommentReactions.tsx`
- Modify: `src/components/task/ActivityFeed.tsx` (comment `<li>` branch)
- Test: `tests/e2e/comments.spec.ts`

**Interfaces:**
- Consumes: `toggleReactionAction` (Task 3); `CommentReaction`, `REACTION_EMOJIS`, `applyToggle`, `reactorsLabel` (Tasks 1, 4); `FeedEntry.reactions` (Task 4).
- Produces: `CommentReactions({ workspaceSlug, commentId, reactions, currentUserId })`.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/comments.spec.ts`:

```ts
test('a reaction toggles on and off', async ({ page }) => {
  await signUpWithTask(page, 'reactions');
  await page.getByRole('button', { name: 'Talk about me', exact: true }).click();

  await page.getByLabel('Comment').fill('React to this');
  await page.getByRole('button', { name: 'Comment' }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'React to this' });
  await expect(item).toBeVisible();

  await item.getByRole('button', { name: 'Add reaction' }).click();
  await page.getByRole('button', { name: 'React with 👍', exact: true }).click();

  const chip = item.getByRole('button', { name: 'React with 👍 (1)' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await chip.click();
  await expect(chip).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn e2e tests/e2e/comments.spec.ts -g "reaction"`
Expected: FAIL — no "Add reaction" button.

- [ ] **Step 3: Create `src/components/task/CommentReactions.tsx`**

```tsx
'use client';

import { IconMoodPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import * as Tooltip from '@/components/ui/tooltip';
import {
  applyToggle, reactorsLabel, REACTION_EMOJIS, type CommentReaction, type ReactionEmoji,
} from '@/lib/reactions';
import { settle } from '@/lib/settle';
import { toggleReactionAction } from '@/server/comments/actions';
import { cn } from '@/utils/cn';

/**
 * A comment's reaction chips plus the button that adds one. Each click applies
 * to the previous optimistic state (a reducer, not a value), so fast repeated
 * clicks compose instead of all toggling the stale server prop.
 */
export function CommentReactions({
  workspaceSlug,
  commentId,
  reactions,
  currentUserId,
}: {
  workspaceSlug: string;
  commentId: string;
  reactions: CommentReaction[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, toggleShown] = useOptimistic(
    reactions,
    (state: CommentReaction[], emoji: ReactionEmoji) => applyToggle(state, emoji, currentUserId),
  );
  const [, startTransition] = useTransition();

  function toggle(emoji: ReactionEmoji) {
    setOpen(false);
    startTransition(async () => {
      toggleShown(emoji);
      const result = await settle(toggleReactionAction(workspaceSlug, { commentId, emoji }));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {shown.map((r) => (
          <Tooltip.Root key={r.emoji}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-pressed={r.reactedByMe}
                aria-label={`React with ${r.emoji} (${r.count})`}
                onClick={() => toggle(r.emoji)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-full px-2 text-paragraph-xs ring-1 ring-inset transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
                  r.reactedByMe
                    ? 'bg-primary-alpha-10 text-primary-base ring-primary-base'
                    : 'bg-bg-white-0 text-text-sub-600 ring-stroke-soft-200 hover:bg-bg-soft-200',
                )}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="tabular-nums">{r.count}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{reactorsLabel(r, currentUserId)}</Tooltip.Content>
          </Tooltip.Root>
        ))}

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <CompactButton.Root
              type="button"
              variant="ghost"
              size="medium"
              aria-label="Add reaction"
              className="text-text-soft-400"
            >
              <CompactButton.Icon as={IconMoodPlus} />
            </CompactButton.Root>
          </Popover.Trigger>
          <Popover.Content align="start" showArrow={false} sideOffset={6} className="p-1.5">
            <div className="flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React with ${emoji}`}
                  onClick={() => toggle(emoji)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-lg transition-colors duration-150',
                    'hover:bg-bg-soft-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
    </Tooltip.Provider>
  );
}
```

- [ ] **Step 4: Render it in `ActivityFeed.tsx`**

Add the import `import { CommentReactions } from '@/components/task/CommentReactions';` and replace:

```tsx
                ) : (
                  <Markdown className="mt-1">{entry.body}</Markdown>
                )}
```

with:

```tsx
                ) : (
                  <>
                    <Markdown className="mt-1">{entry.body}</Markdown>
                    <CommentReactions
                      workspaceSlug={workspaceSlug}
                      commentId={entry.id}
                      reactions={entry.reactions}
                      currentUserId={currentUserId}
                    />
                  </>
                )}
```

- [ ] **Step 5: Run e2e, typecheck, lint**

Run: `yarn typecheck && yarn lint && yarn e2e tests/e2e/comments.spec.ts`
Expected: all green, including the new reaction test and the existing comment tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/task/CommentReactions.tsx src/components/task/ActivityFeed.tsx tests/e2e/comments.spec.ts
git commit -m "feat(reactions): reaction chips and picker on comments"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the whole unit/server suite**

Run: `yarn test`
Expected: all pass. Fix anything the new `reactions` field on feed entries or the `reaction` kind broke elsewhere (e.g. tests that `toEqual` a full comment feed entry gain `reactions: []`).

- [ ] **Step 2: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test(reactions): align existing tests with reactions field"
```

(Skip if nothing changed.)
