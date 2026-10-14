# Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Taskeeper installable on phones, comfortable at 375 px, and able to send web push for reminders, mentions, task changes and project changes.

**Architecture:** A hand-written service worker and a Next `manifest.ts` make the existing app installable. Notification insert sites return `(id, created_at::text)` stamps; `after()` (or the cron) hands them to `deliverPush`, which re-reads committed rows, filters by per-kind user toggles and sends through `web-push`. A bottom tab bar, an Inbox page and per-view phone layouts reuse the existing components.

**Tech Stack:** Next.js 16.3 (App Router, `after()`, `MetadataRoute.Manifest`), Drizzle + Postgres, `web-push`, React 19, Tailwind, Align UI atoms, dnd-kit, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-mobile-pwa-design.md`

## Global Constraints

- Branch `feat/mobile-pwa` off `develop`; PR into `develop` only. Never push or open the PR unasked. Never change `package.json` `version`.
- Commit messages: plain, no `Co-Authored-By` or other attribution trailer.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (server-only, no `NEXT_PUBLIC_*`). Missing any → push off, everything else works.
- Push toggles: `push_reminders` (true), `push_mentions` (true), `push_task_changes` (true, includes reactions), `push_project_changes` (false). `digest` never pushes.
- Delivery: `TTL: 86400`; `urgency: 'high'` for `mention` and `reminder`, `'normal'` otherwise; at most 6 sends in flight; 404/410 deletes the subscription; never throws; no retries.
- Notification `tag` = notification id. Payload body truncated to 180 chars.
- Bottom bar below `lg` only; slots Projects · To-do · ＋ · Search · Inbox; touch targets ≥ 44 px; `nav aria-label="Primary"`.
- Service worker registers in production builds only (`process.env.NODE_ENV === 'production'`), never under `next dev`.
- Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (AGENTS.md): `01-app/02-guides/progressive-web-apps.md`, `01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`, `01-app/03-api-reference/04-functions/generate-viewport.md`, `after`.
- Unit tests: `yarn test <file>`; they share the test DB (`fileParallelism: false`). E2E must not reuse the user's `next dev` on :3000: run on :3100 with `BETTER_AUTH_URL=http://localhost:3100` (temp config, see memory notes / earlier PRs).
- After code changes run `graphify update .`.

## Plan decisions (differ from the spec text; spec updated in Task 7)

1. **Push link** reuses `bellHref` (same target as the bell): deleted subject → workspace home, archived project → settings/projects. The spec's "else Inbox" is dropped for one rule everywhere.
2. **No batching in `schedulePush`:** one `after()` per insert call. Team scale makes batching pointless.
3. **Calendar agenda:** `CalendarMonth` already renders a phone list with CSS (`sm:hidden`). It is extracted into `CalendarAgenda` with richer rows. The CSS switch stays and there is no `useMediaQuery` (YAGNI).
4. **List on phone:** the table already has row checkboxes. The stacked rows keep a checkbox instead of adding long-press selection.
5. **Task detail:** already stacks title → fields → body below `lg` (`TaskDetailView.tsx:300-313`). No code change, only an e2e assertion.
6. **Toaster and bulk bar** are lifted above the bottom bar below `lg`. The spec didn't mention this, but without it they'd overlap.

## Review Focus

1. **Endpoint moves between accounts on one browser.** User A subscribes, signs out, user B signs in and subscribes. A must stop getting B's pushes and B must not get A's. Pinned in Task 1 (`subscribe` re-owns).
2. **Rollback after notify.** A service throws after `notifyTaskChange` inside its transaction. `after()` still runs, and no push may go out. Pinned in Task 2 (missing row skipped).
3. **Merged task change.** Two edits in a row merge into one unread row. Each edit pushes with the same tag, and an older stamp must not resend. Pinned in Task 2 (stale stamp skipped).
4. **Push provider rejects, or a dead device.** A 500 from the provider must not break the user's edit request, and a 410 must remove the device. Pinned in Task 2.
5. **Bottom bar hides content.** The last list row, the bulk bar, toasts and the comment composer must stay reachable at 375×667. Pinned in Task 5 e2e (scroll to last row and click it; bulk bar visible above bar).

---

### Task 1: Push data: schema, settings, subscription service

**Files:**
- Create: `src/db/schema/push.ts`
- Modify: `src/db/schema/index.ts` (export), `src/db/schema/settings.ts` (4 columns)
- Create: `src/lib/push.ts` (pure: kinds, defaults, mapping)
- Create: `src/server/push/config.ts`, `src/server/push/service.ts`, `src/server/push/actions.ts`
- Modify: `tests/setup/db.ts` (truncate `push_subscription`)
- Modify: `tests/setup/env.ts` (delete VAPID vars)
- Test: `tests/unit/push-prefs.test.ts`, `tests/server/push-subscriptions.test.ts`

**Interfaces:**
- Produces:
  - `pushSubscription` table (Drizzle)
  - `type PushPrefs = { reminders: boolean; mentions: boolean; taskChanges: boolean; projectChanges: boolean }`
  - `PUSH_DEFAULTS: PushPrefs`
  - `pushAllowed(kind: BellKind, prefs: PushPrefs): boolean`
  - `vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null`
  - `subscribePush(ctx: UserContext, input: unknown, userAgent: string | null): Promise<Result<null>>`
  - `unsubscribePush(ctx: UserContext, endpoint: string): Promise<Result<null>>`
  - `getPushPrefs(ctx: UserContext): Promise<PushPrefs>`
  - `updatePushPrefs(ctx: UserContext, input: PushPrefs): Promise<Result<null>>`
  - actions `subscribePushAction`, `unsubscribePushAction`, `updatePushPrefsAction`

- [ ] **Step 1: Write the failing pure test**

`tests/unit/push-prefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PUSH_DEFAULTS, pushAllowed } from '@/lib/push';

describe('pushAllowed', () => {
  const all = { reminders: true, mentions: true, taskChanges: true, projectChanges: true };
  const none = { reminders: false, mentions: false, taskChanges: false, projectChanges: false };

  it('maps each kind to its own toggle', () => {
    expect(pushAllowed('reminder', { ...none, reminders: true })).toBe(true);
    expect(pushAllowed('mention', { ...none, mentions: true })).toBe(true);
    expect(pushAllowed('task_change', { ...none, taskChanges: true })).toBe(true);
    expect(pushAllowed('project_change', { ...none, projectChanges: true })).toBe(true);
    expect(pushAllowed('mention', { ...all, mentions: false })).toBe(false);
  });

  it('never pushes the digest', () => {
    expect(pushAllowed('digest', all)).toBe(false);
  });

  it('defaults: project changes off, the rest on', () => {
    expect(PUSH_DEFAULTS).toEqual({ reminders: true, mentions: true, taskChanges: true, projectChanges: false });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module '@/lib/push'`)

Run: `yarn test tests/unit/push-prefs.test.ts`

- [ ] **Step 3: Implement `src/lib/push.ts`**

```ts
/**
 * Web push: which notification kinds push, per the user's toggles. Pure, so the
 * sender, the settings form and tests share it.
 */
import type { BellKind } from './notifications';

export type PushPrefs = { reminders: boolean; mentions: boolean; taskChanges: boolean; projectChanges: boolean };

export const PUSH_DEFAULTS: PushPrefs = { reminders: true, mentions: true, taskChanges: true, projectChanges: false };

const TOGGLE: Record<BellKind, keyof PushPrefs | null> = {
  reminder: 'reminders',
  mention: 'mentions',
  task_change: 'taskChanges',
  project_change: 'projectChanges',
  // Daily email content; a phone buzz each morning would be noise.
  digest: null,
};

export function pushAllowed(kind: BellKind, prefs: PushPrefs): boolean {
  const key = TOGGLE[kind];
  return key !== null && prefs[key];
}
```

- [ ] **Step 4: Run it, expect PASS**

- [ ] **Step 5: Schema**

`src/db/schema/push.ts`:

```ts
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

// One row per browser/device that turned push on. The endpoint is the device's
// address at its push service; it moves with whoever subscribed last there.
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('push_subscription_user_idx').on(t.userId)],
);
```

Add `export * from './push';` to `src/db/schema/index.ts`. In `settings.ts` `userSettings`, after `changeSound`:

```ts
    // Web push per kind (src/lib/push.ts); apply to all the user's devices.
    pushReminders: boolean('push_reminders').notNull().default(true),
    pushMentions: boolean('push_mentions').notNull().default(true),
    pushTaskChanges: boolean('push_task_changes').notNull().default(true),
    pushProjectChanges: boolean('push_project_changes').notNull().default(false),
```

In `tests/setup/db.ts` add `push_subscription,` to the TRUNCATE list (before `workspace_settings`). In `tests/setup/env.ts` add:

```ts
// Tests must never send real web push; without these, delivery is off (src/server/push/config.ts).
for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  delete process.env[name];
}
```

Run: `yarn db:setup:test && yarn db:setup` (test + local dev DB). Expected: drizzle-kit push reports the new table and 4 columns.

- [ ] **Step 6: Write failing server tests**

`tests/server/push-subscriptions.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser } from '../setup/factories';
import { pushSubscription } from '@/db';
import type { UserContext } from '@/lib/session';
import { getPushPrefs, subscribePush, unsubscribePush, updatePushPrefs } from '@/server/push/service';

beforeEach(resetDb);
afterAll(closeDb);

const sub = (endpoint = 'https://push.example.test/abc') => ({
  endpoint, expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
});

async function users() {
  const ada = await createUser('push-ada@example.com', 'Ada');
  const bob = await createUser('push-bob@example.com', 'Bob');
  return { ada: { userId: ada.id } as UserContext, bob: { userId: bob.id } as UserContext };
}

describe('subscribePush', () => {
  it('stores one row per endpoint', async () => {
    const { ada } = await users();
    expect((await subscribePush(ada, sub(), 'iPhone')).ok).toBe(true);
    expect((await subscribePush(ada, sub(), 'iPhone')).ok).toBe(true);
    const rows = await db.select().from(pushSubscription);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ada.userId, userAgent: 'iPhone' });
  });

  it('moves an endpoint to whoever subscribed last on that browser', async () => {
    const { ada, bob } = await users();
    await subscribePush(ada, sub(), null);
    await subscribePush(bob, sub(), null);
    const rows = await db.select().from(pushSubscription);
    expect(rows.map((r) => r.userId)).toEqual([bob.userId]);
  });

  it('rejects a non-https endpoint or missing keys', async () => {
    const { ada } = await users();
    expect((await subscribePush(ada, { ...sub(), endpoint: 'http://x.test' }, null)).ok).toBe(false);
    expect((await subscribePush(ada, { endpoint: 'https://x.test' }, null)).ok).toBe(false);
  });
});

describe('unsubscribePush', () => {
  it('deletes only the caller’s own endpoint', async () => {
    const { ada, bob } = await users();
    await subscribePush(ada, sub(), null);
    await unsubscribePush(bob, sub().endpoint);
    expect(await db.select().from(pushSubscription)).toHaveLength(1);
    await unsubscribePush(ada, sub().endpoint);
    expect(await db.select().from(pushSubscription)).toHaveLength(0);
  });
});

describe('push prefs', () => {
  it('returns defaults without a settings row, then what was saved', async () => {
    const { ada } = await users();
    expect(await getPushPrefs(ada)).toEqual({ reminders: true, mentions: true, taskChanges: true, projectChanges: false });
    const saved = { reminders: false, mentions: true, taskChanges: false, projectChanges: true };
    expect((await updatePushPrefs(ada, saved)).ok).toBe(true);
    expect(await getPushPrefs(ada)).toEqual(saved);
  });

  it('rejects non-boolean prefs', async () => {
    const { ada } = await users();
    const bad = { reminders: 'yes' } as unknown as Parameters<typeof updatePushPrefs>[1];
    expect((await updatePushPrefs(ada, bad)).ok).toBe(false);
  });
});

it('cascades with the user', async () => {
  const { ada } = await users();
  await subscribePush(ada, sub(), null);
  await db.execute(`delete from "user" where id = '${ada.userId}'` as never);
  expect(await db.select().from(pushSubscription).where(eq(pushSubscription.userId, ada.userId))).toHaveLength(0);
});
```

(If `db.execute` with a raw string does not type-check, use `` sql`delete from "user" where id = ${ada.userId}` `` with `import { sql } from 'drizzle-orm'`.)

- [ ] **Step 7: Run, expect FAIL** (`Cannot find module '@/server/push/service'`)

Run: `yarn test tests/server/push-subscriptions.test.ts`

- [ ] **Step 8: Implement config, service, actions**

`src/server/push/config.ts`:

```ts
/** VAPID keys for web push, or null when push is not configured (then nothing sends). */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
```

`src/server/push/service.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, pushSubscription, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import { PUSH_DEFAULTS, type PushPrefs } from '@/lib/push';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { UserContext } from '@/lib/session';

// PushSubscription.toJSON(); expirationTime is ignored (browsers send null).
const subscriptionSchema = z.object({
  endpoint: z.url().startsWith('https://').max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

/**
 * Saves this browser's push address for the caller. Upsert on the endpoint, moving it
 * to the caller: the endpoint belongs to the browser, so whoever subscribed there last
 * gets its pushes, never the person who used it before.
 */
export async function subscribePush(ctx: UserContext, input: unknown, userAgent: string | null): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return err('This browser sent an invalid push subscription.');
    const { endpoint, keys } = parsed.data;
    const values = { userId: ctx.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent?.slice(0, 512) ?? null };
    await db
      .insert(pushSubscription)
      .values({ id: newId(), endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { ...values, createdAt: new Date(), lastUsedAt: null } });
    return ok(null);
  });
}

/** Forgets this browser, only when it is the caller's: another user's endpoint is left alone. */
export async function unsubscribePush(ctx: UserContext, endpoint: string): Promise<Result<null>> {
  return withAction(async () => {
    if (typeof endpoint !== 'string') return err('Missing endpoint.');
    await db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, ctx.userId)));
    return ok(null);
  });
}

export async function getPushPrefs(ctx: UserContext): Promise<PushPrefs> {
  const [row] = await db
    .select({
      reminders: userSettings.pushReminders,
      mentions: userSettings.pushMentions,
      taskChanges: userSettings.pushTaskChanges,
      projectChanges: userSettings.pushProjectChanges,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row ?? PUSH_DEFAULTS;
}

const prefsSchema = z.object({
  reminders: z.boolean(), mentions: z.boolean(), taskChanges: z.boolean(), projectChanges: z.boolean(),
});

export async function updatePushPrefs(ctx: UserContext, input: PushPrefs): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = prefsSchema.safeParse(input);
    if (!parsed.success) return err('Invalid push settings.');
    const set = {
      pushReminders: parsed.data.reminders,
      pushMentions: parsed.data.mentions,
      pushTaskChanges: parsed.data.taskChanges,
      pushProjectChanges: parsed.data.projectChanges,
    };
    await db.insert(userSettings).values({ userId: ctx.userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
    return ok(null);
  });
}
```

(Check the repo's zod version: if `z.url()` is not exported, use `z.string().url()`.)

`src/server/push/actions.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { PushPrefs } from '@/lib/push';
import { withAction, type Result } from '@/lib/result';
import { requireUser } from '@/lib/session';
import { subscribePush, unsubscribePush, updatePushPrefs } from './service';

export async function subscribePushAction(subscription: unknown): Promise<Result<null>> {
  return withAction(async () =>
    subscribePush(await requireUser(), subscription, (await headers()).get('user-agent')),
  );
}

export async function unsubscribePushAction(endpoint: string): Promise<Result<null>> {
  return withAction(async () => unsubscribePush(await requireUser(), endpoint));
}

export async function updatePushPrefsAction(input: PushPrefs): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updatePushPrefs(await requireUser(), input);
    if (result.ok) revalidatePath('/settings/preferences');
    return result;
  });
}
```

- [ ] **Step 9: Run tests, expect PASS**

Run: `yarn test tests/server/push-subscriptions.test.ts tests/unit/push-prefs.test.ts tests/server/user-settings.test.ts tests/server/schema.test.ts`

- [ ] **Step 10: Typecheck, then commit**

```bash
yarn typecheck
git add src/db/schema/push.ts src/db/schema/index.ts src/db/schema/settings.ts src/lib/push.ts src/server/push tests/setup/db.ts tests/setup/env.ts tests/unit/push-prefs.test.ts tests/server/push-subscriptions.test.ts
git commit -m "feat(push): subscription table, per-kind push prefs and their actions"
```

---

### Task 2: Push delivery

**Files:**
- Modify: `package.json` (add `web-push`, `@types/web-push` dev) via `yarn add web-push && yarn add -D @types/web-push`
- Create: `src/server/push/message.ts`, `src/server/push/deliver.ts`, `src/server/push/schedule.ts`
- Modify: `src/server/notifications/changes.ts` (3 inserts → `RETURNING`, `schedulePush`)
- Modify: `src/server/reminders/select.ts` (`insertDrafts`/`claimNotifications` return refs)
- Modify: `src/server/reminders/run.ts` (use refs; call `deliverPush`)
- Modify: `src/server/push/service.ts` + `actions.ts` (add `sendTestPush`)
- Test: `tests/unit/push-message.test.ts`, `tests/server/push-deliver.test.ts`; update `tests/server/reminder-select.test.ts` if it checks element shape

**Interfaces:**
- Consumes: `pushSubscription`, `pushAllowed`, `vapidConfig` (Task 1); `bellText`, `bellHref`, `BellItem` (`src/lib/notifications.ts`).
- Produces:
  - `type PushRef = { id: string; stamp: string }`: `stamp` is `created_at::text`, exact to the microsecond.
  - `type PushPayload = { title: string; body: string; url: string; tag: string }`
  - `pushMessage(slug: string, item: BellItem & { id: string }): PushPayload`
  - `deliverPush(refs: PushRef[]): Promise<void>`
  - `sendToSubscriptions(subs: SubRow[], payload: PushPayload, urgency: 'high' | 'normal'): Promise<{ sent: number; failed: number }>`
  - `schedulePush(refs: PushRef[]): void`
  - `claimNotifications(drafts): Promise<Array<{ workspaceId: string } & PushRef>>`
  - `sendTestPush(ctx: UserContext): Promise<Result<{ sent: number; failed: number }>>` and `sendTestPushAction()`

- [ ] **Step 1: Install**

Run: `yarn add web-push && yarn add -D @types/web-push`
Expected: both in package.json at exact versions (the repo pins exact versions; remove any `^` yarn adds).

- [ ] **Step 2: Failing message test**

`tests/unit/push-message.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pushMessage } from '@/server/push/message';

const base = { id: 'n1', taskId: 't1', projectId: 'p1' };

describe('pushMessage', () => {
  it('mention: bell copy, task link, id as tag', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'mention',
      data: { title: 'Fix login', projectName: 'Web', actorName: 'Anna', where: ['comment'], comment: 'see this' },
    });
    expect(m).toEqual({ title: 'Anna mentioned you', body: 'Fix login: “see this”', url: '/acme/tasks/t1', tag: 'n1' });
  });

  it('task change: title is the task, body the bell detail', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'task_change',
      data: { title: 'Fix login', projectName: 'Web', actorName: 'Anna', changes: ['status'], status: 'Done' },
    });
    expect(m.title).toBe('Fix login');
    expect(m.body).toBe('Anna moved to Done');
  });

  it('deleted project links to the workspace, like the bell', () => {
    const m = pushMessage('acme', {
      ...base, taskId: null, kind: 'project_change',
      data: { projectName: 'Web', actorName: 'Anna', changes: ['deleted'] },
    });
    expect(m.url).toBe('/acme');
  });

  it('truncates a long body to 180 chars', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'mention',
      data: { title: 'T', projectName: 'Web', actorName: 'Anna', where: ['comment'], comment: 'x'.repeat(400) },
    });
    expect(m.body.length).toBe(180);
    expect(m.body.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `yarn test tests/unit/push-message.test.ts`

- [ ] **Step 4: Implement `src/server/push/message.ts`**

```ts
import { bellHref, bellText, type BellItem } from '@/lib/notifications';

export type PushPayload = { title: string; body: string; url: string; tag: string };

const BODY_MAX = 180;

/** What the phone shows: the bell's own copy and link, tagged so a merged update replaces the earlier banner. */
export function pushMessage(slug: string, item: BellItem & { id: string }): PushPayload {
  const { title, detail } = bellText(item);
  const body = detail.length > BODY_MAX ? `${detail.slice(0, BODY_MAX - 1)}…` : detail;
  return { title, body, url: bellHref(slug, item), tag: item.id };
}
```

- [ ] **Step 5: Run, expect PASS** (if the mention copy differs, the test is wrong, not the bell: align the expected strings with `bellText`)

- [ ] **Step 6: Failing delivery test**

`tests/server/push-deliver.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebPushError extends Error {
  constructor(public statusCode: number) { super(`status ${statusCode}`); }
}
const sendNotification = vi.fn(async (..._args: unknown[]) => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { sendNotification }, WebPushError: FakeWebPushError }));

const { sql, eq } = await import('drizzle-orm');
const { closeDb, db, resetDb } = await import('../setup/db');
const { createUser, createWorkspace, joinWorkspace } = await import('../setup/factories');
const { notification, pushSubscription, userSettings } = await import('@/db');
const { newId } = await import('@/lib/ids');
const { deliverPush } = await import('@/server/push/deliver');

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:t@example.com' };

beforeEach(async () => {
  await resetDb();
  Object.assign(process.env, VAPID);
});
afterEach(() => {
  for (const k of Object.keys(VAPID)) delete process.env[k];
  vi.clearAllMocks();
});
afterAll(closeDb);

async function setup() {
  const ada = await createUser('pd-ada@example.com', 'Ada');
  const bob = await createUser('pd-bob@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'acme');
  await joinWorkspace(bob.id, ws.id, 'member');
  await db.insert(pushSubscription).values({ id: newId(), userId: ada.id, endpoint: 'https://push.test/ada', p256dh: 'p', auth: 'a' });
  return { ada, bob, ws };
}

/** Inserts a mention for Ada and returns its ref, as the insert sites do. */
async function mention(userId: string, workspaceId: string) {
  const id = newId();
  const { rows } = await db.execute<{ id: string; stamp: string }>(sql`
    INSERT INTO notification (id, user_id, workspace_id, kind, dedupe_key, data, created_at)
    VALUES (${id}, ${userId}, ${workspaceId}, 'mention', ${`mtn:${id}`},
      ${JSON.stringify({ title: 'Fix', projectName: 'Web', actorName: 'Bob', where: ['description'] })}::jsonb, clock_timestamp())
    RETURNING id, created_at::text AS stamp
  `);
  return rows[0];
}

describe('deliverPush', () => {
  it('sends a committed row to each of the recipient’s devices', async () => {
    const { ada, ws } = await setup();
    const ref = await mention(ada.id, ws.id);
    await deliverPush([ref]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payload, options] = sendNotification.mock.calls[0] as [{ endpoint: string }, string, { urgency: string; TTL: number }];
    expect(sub.endpoint).toBe('https://push.test/ada');
    expect(JSON.parse(payload)).toMatchObject({ title: 'Bob mentioned you', tag: ref.id, url: '/acme' });
    expect(options).toMatchObject({ urgency: 'high', TTL: 86400 });
    const [row] = await db.select().from(pushSubscription);
    expect(row.lastUsedAt).not.toBeNull();
  });

  it('skips a ref whose row never committed (rolled back)', async () => {
    await setup();
    await deliverPush([{ id: 'gone', stamp: '2026-10-13 10:00:00.123456+00' }]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips a stale stamp: a later merge pushes for itself', async () => {
    const { ada, ws } = await setup();
    const ref = await mention(ada.id, ws.id);
    await db.execute(sql`UPDATE notification SET created_at = clock_timestamp() WHERE id = ${ref.id}`);
    await deliverPush([ref]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('respects the kind toggle and never pushes cleared rows', async () => {
    const { ada, ws } = await setup();
    await db.insert(userSettings).values({ userId: ada.id, pushMentions: false });
    await deliverPush([await mention(ada.id, ws.id)]);
    expect(sendNotification).not.toHaveBeenCalled();

    await db.update(userSettings).set({ pushMentions: true });
    const ref = await mention(ada.id, ws.id);
    await db.update(notification).set({ clearedAt: new Date() }).where(eq(notification.id, ref.id));
    await deliverPush([ref]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('deletes a subscription the push service says is gone, and never throws', async () => {
    const { ada, ws } = await setup();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(410));
    await expect(deliverPush([await mention(ada.id, ws.id)])).resolves.toBeUndefined();
    expect(await db.select().from(pushSubscription)).toHaveLength(0);
  });

  it('keeps the subscription on other errors', async () => {
    const { ada, ws } = await setup();
    sendNotification.mockRejectedValueOnce(new FakeWebPushError(500));
    await expect(deliverPush([await mention(ada.id, ws.id)])).resolves.toBeUndefined();
    expect(await db.select().from(pushSubscription)).toHaveLength(1);
  });

  it('does nothing without VAPID config', async () => {
    const { ada, ws } = await setup();
    for (const k of Object.keys(VAPID)) delete process.env[k];
    await deliverPush([await mention(ada.id, ws.id)]);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run, expect FAIL**

Run: `yarn test tests/server/push-deliver.test.ts`

- [ ] **Step 8: Implement `src/server/push/deliver.ts`**

```ts
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import webpush, { WebPushError } from 'web-push';
import { db, notification, organization, pushSubscription, userSettings } from '@/db';
import { PUSH_DEFAULTS, pushAllowed } from '@/lib/push';
import type { BellKind } from '@/lib/notifications';
import type { NotificationData } from '@/lib/reminders';
import { vapidConfig } from './config';
import { pushMessage, type PushPayload } from './message';

/** A notification row as one statement wrote it: created_at as text, so the stamp is exact to the microsecond. */
export type PushRef = { id: string; stamp: string };
export type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

const TTL = 86_400;
const IN_FLIGHT = 6;

async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, items.length) }, worker));
}

/**
 * Sends one payload to each subscription. A device its push service says is gone
 * (404/410) is forgotten; any other failure is logged and dropped: the bell still
 * has the item. Never throws.
 */
export async function sendToSubscriptions(
  subs: SubRow[], payload: PushPayload, urgency: 'high' | 'normal',
): Promise<{ sent: number; failed: number }> {
  const vapid = vapidConfig();
  if (!vapid || subs.length === 0) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  const used: string[] = [];
  let failed = 0;
  await pool(subs, async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL, urgency, vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
      );
      used.push(s.id);
    } catch (error) {
      failed += 1;
      const status = error instanceof WebPushError ? error.statusCode : null;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.error('Web push: send failed', status ?? error);
    }
  });
  try {
    if (gone.length > 0) await db.delete(pushSubscription).where(inArray(pushSubscription.id, gone));
    if (used.length > 0) await db.update(pushSubscription).set({ lastUsedAt: new Date() }).where(inArray(pushSubscription.id, used));
  } catch (error) {
    console.error('Web push: bookkeeping failed', error);
  }
  return { sent: used.length, failed };
}

/**
 * Pushes what these refs wrote, after commit. Re-reads each row by id AND stamp: a
 * rolled-back write has no row and a merge since has a newer stamp (and pushes for
 * itself), so neither sends. Rows whose kind the recipient turned off, and cleared
 * rows, are dropped. Never throws.
 */
export async function deliverPush(refs: PushRef[]): Promise<void> {
  if (refs.length === 0 || !vapidConfig()) return;
  try {
    const pairs = sql.join(refs.map((r) => sql`(${r.id}, ${r.stamp}::timestamptz)`), sql`, `);
    const rows = await db
      .select({
        id: notification.id, kind: notification.kind, taskId: notification.taskId, projectId: notification.projectId,
        data: notification.data, slug: organization.slug,
        sub: { id: pushSubscription.id, endpoint: pushSubscription.endpoint, p256dh: pushSubscription.p256dh, auth: pushSubscription.auth },
        prefs: {
          reminders: userSettings.pushReminders, mentions: userSettings.pushMentions,
          taskChanges: userSettings.pushTaskChanges, projectChanges: userSettings.pushProjectChanges,
        },
      })
      .from(notification)
      .innerJoin(organization, eq(organization.id, notification.workspaceId))
      .innerJoin(pushSubscription, eq(pushSubscription.userId, notification.userId))
      .leftJoin(userSettings, eq(userSettings.userId, notification.userId))
      .where(and(sql`(${notification.id}, ${notification.createdAt}) IN (${pairs})`, isNull(notification.clearedAt)));

    const byNotification = new Map<string, { row: (typeof rows)[number]; subs: SubRow[] }>();
    for (const row of rows) {
      const prefs = row.prefs.reminders === null ? PUSH_DEFAULTS : (row.prefs as typeof PUSH_DEFAULTS);
      if (!pushAllowed(row.kind as BellKind, prefs)) continue;
      const entry = byNotification.get(row.id) ?? { row, subs: [] };
      entry.subs.push(row.sub);
      byNotification.set(row.id, entry);
    }

    for (const { row, subs } of byNotification.values()) {
      const payload = pushMessage(row.slug, {
        id: row.id, kind: row.kind as BellKind, taskId: row.taskId, projectId: row.projectId, data: row.data as NotificationData,
      });
      await sendToSubscriptions(subs, payload, row.kind === 'mention' || row.kind === 'reminder' ? 'high' : 'normal');
    }
  } catch (error) {
    console.error('Web push: delivery failed', error);
  }
}
```

(`row.prefs.reminders === null` happens when the left join finds no `user_settings` row. Check the `notification.data` type import: `NotificationData` lives in `src/lib/reminders.ts`, per the `import` at the top of `src/lib/notifications.ts`.)

- [ ] **Step 9: Run delivery test, expect PASS**

- [ ] **Step 10: Failing capture tests**

Append to `tests/server/push-deliver.test.ts` (same file, same mocks), and add an `after` mock at the top of the file, before the dynamic imports:

```ts
const afterCallbacks: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => { afterCallbacks.push(callback); }),
}));
```

with `afterCallbacks.length = 0` in `beforeEach`, and:

```ts
const { createProject } = await import('@/server/projects/service');
const { createTask, updateTask } = await import('@/server/tasks/service');
const { createComment } = await import('@/server/comments/service');
const runAfter = () => Promise.all(afterCallbacks.splice(0).map((cb) => cb()));

describe('capture at the insert sites', () => {
  async function scene() {
    const { ada, bob, ws } = await setup();
    const ctx = (userId: string) => ({ userId, workspaceId: ws.id, slug: 'acme', role: 'owner' as const, timezone: 'UTC', workspaceTimezone: 'UTC' });
    const project = await createProject(ctx(ada.id), { name: 'Web' });
    if (!project.ok) throw new Error('setup');
    const made = await createTask(ctx(ada.id), { projectId: project.data.id, title: 'Ship' });
    if (!made.ok) throw new Error('setup');
    afterCallbacks.length = 0;
    return { ada, bob, ctx, taskId: made.data.id };
  }

  it('a teammate’s edit pushes to the task’s creator after the response', async () => {
    const { bob, ctx, taskId } = await scene();
    await updateTask(ctx(bob.id), { taskId, title: 'Ship it' });
    expect(sendNotification).not.toHaveBeenCalled();
    await runAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('two merged edits push twice with the same tag', async () => {
    const { bob, ctx, taskId } = await scene();
    await updateTask(ctx(bob.id), { taskId, title: 'Ship it' });
    await runAfter();
    await updateTask(ctx(bob.id), { taskId, priority: 'high' });
    await runAfter();
    const tags = sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string).tag);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe(tags[1]);
  });

  it('a mention in a comment pushes', async () => {
    const { ada, bob, ctx, taskId } = await scene();
    await createComment(ctx(bob.id), { taskId, body: `hey @[Ada](${ada.id})` });
    await runAfter();
    expect(sendNotification.mock.calls.some((c) => JSON.parse(c[1] as string).title === 'Bob mentioned you')).toBe(true);
  });
});
```

(Check `updateTask`'s and `createComment`'s input names and the mention markup in `tests/server/mentions.test.ts`; use what those tests use.)

- [ ] **Step 11: Run, expect FAIL** (no push sent: the insert sites don't schedule yet)

- [ ] **Step 12: Implement capture**

`src/server/push/schedule.ts`:

```ts
import { after } from 'next/server';
import { vapidConfig } from './config';
import { deliverPush, type PushRef } from './deliver';

/**
 * Pushes these rows after this request's response, once the caller's transaction
 * has committed. after() runs even on rollback; deliverPush re-reads by stamp, so a
 * rolled-back write sends nothing. Outside a request (seed, scripts) nothing pushes.
 */
export function schedulePush(refs: PushRef[]): void {
  if (refs.length === 0 || !vapidConfig()) return;
  try {
    after(() => deliverPush(refs));
  } catch {
    // No request scope.
  }
}
```

In `src/server/notifications/changes.ts`, for each of the three `await tx.execute(sql\`INSERT INTO notification AS n ...\`)` calls:
- append `RETURNING n.id, n.created_at::text AS stamp` after the `DO UPDATE SET ...` clause,
- change to `const { rows } = await tx.execute<PushRef>(sql\`...\`);` followed by `schedulePush(rows);`
- add imports: `import { schedulePush } from '@/server/push/schedule';` and `import type { PushRef } from '@/server/push/deliver';`.

In `src/server/reminders/select.ts`:

```ts
import type { PushRef } from '@/server/push/deliver';

export type ClaimedNotification = { workspaceId: string } & PushRef;

async function insertDrafts(drafts: NotificationDraft[]): Promise<ClaimedNotification[]> {
  return db
    .insert(notification)
    .values(drafts.map((d) => ({ id: newId(), ...d })))
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ workspaceId: notification.workspaceId, id: notification.id, stamp: sql<string>`${notification.createdAt}::text` });
}
```

Change `claimNotifications` to return `Promise<ClaimedNotification[]>` (body unchanged except the `inserted` array type). Update its doc comment: "returns each row it inserted".

In `src/server/reminders/run.ts` `runReminders`:

```ts
  const claimedIn = await claimNotifications(drafts);
  const claimed = claimedIn.length;

  for (const workspaceId of new Set(claimedIn.map((c) => c.workspaceId))) {
    await emitChangeFor(workspaceId, db);
  }

  // Phones first: email can take minutes with the send gap; a push is one round trip.
  await deliverPush(claimedIn);
```

(import `deliverPush` from `@/server/push/deliver`).

- [ ] **Step 13: Test push**

Add to `src/server/push/service.ts`:

```ts
import { sendToSubscriptions } from './deliver';

/** "Push is working" to every device of the caller. */
export async function sendTestPush(ctx: UserContext): Promise<Result<{ sent: number; failed: number }>> {
  return withAction(async () => {
    const subs = await db
      .select({ id: pushSubscription.id, endpoint: pushSubscription.endpoint, p256dh: pushSubscription.p256dh, auth: pushSubscription.auth })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, ctx.userId));
    if (subs.length === 0) return err('Turn on push on this device first.');
    const result = await sendToSubscriptions(
      subs,
      { title: 'Push is working', body: 'Taskeeper notifications will show up like this.', url: '/', tag: 'push-test' },
      'high',
    );
    return result.sent === 0 ? err('Could not reach your devices’ push service. Try again.') : ok(result);
  });
}
```

and `sendTestPushAction()` in `actions.ts` (`withAction(async () => sendTestPush(await requireUser()))`). Add a test to `push-deliver.test.ts`:

```ts
it('sendTestPush reaches every device of the caller', async () => {
  const { ada } = await setup();
  const { sendTestPush } = await import('@/server/push/service');
  const result = await sendTestPush({ userId: ada.id } as never);
  expect(result).toEqual({ ok: true, data: { sent: 1, failed: 0 } });
});
```

- [ ] **Step 14: Run the affected suites, expect PASS**

Run: `yarn test tests/server/push-deliver.test.ts tests/unit/push-message.test.ts tests/server/reminder-select.test.ts tests/server/reminder-run.test.ts tests/server/change-notifications.test.ts tests/server/mentions.test.ts tests/server/comment-reactions.test.ts tests/server/lock-order.test.ts`

- [ ] **Step 15: Typecheck, commit**

```bash
yarn typecheck
git add package.json yarn.lock src/server/push src/server/notifications/changes.ts src/server/reminders tests/unit/push-message.test.ts tests/server/push-deliver.test.ts tests/server/reminder-select.test.ts
git commit -m "feat(push): deliver notifications by web push after commit"
```

---

### Task 3: Installable shell (manifest, icons, viewport, service worker, offline page)

**Files:**
- Create: `scripts/pwa-icons.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/icons/badge-72.png`
- Create: `src/app/manifest.ts`, `public/sw.js`, `src/components/brand/ServiceWorkerRegister.tsx`, `src/app/offline/page.tsx`
- Modify: `src/app/layout.tsx` (viewport, appleWebApp, register), `next.config.ts` (sw headers), `package.json` (script `pwa:icons`)
- Test: `tests/e2e/pwa.spec.ts`

**Interfaces:**
- Produces: `/manifest.webmanifest`, `/sw.js` (handles `push` payload `PushPayload` from Task 2), `/offline`.

- [ ] **Step 1: Read the guides**

`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `.../04-functions/generate-viewport.md`.

- [ ] **Step 2: Icons script**

`scripts/pwa-icons.ts`:

```ts
/** Renders the PWA icons from src/app/icon.svg. Run once after the logo changes: yarn pwa:icons */
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync('src/app/icon.svg');
mkdirSync('public/icons', { recursive: true });

for (const size of [192, 512]) {
  await sharp(svg, { density: 1200 }).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
}

// Maskable: the logo at 70% on the brand colour, so a circle or squircle mask never cuts it.
const inner = await sharp(svg, { density: 1200 }).resize(358, 358).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#615fff' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile('public/icons/icon-maskable-512.png');

// Android status-bar badge: white silhouette on transparent.
await sharp(svg, { density: 1200 }).resize(72, 72).threshold(1).negate({ alpha: false }).png().toFile('public/icons/badge-72.png');
```

Add `"pwa:icons": "tsx scripts/pwa-icons.ts"` to package.json scripts. Run `yarn pwa:icons`. Expected: four PNGs. Open them with the Read tool to eyeball them. If the badge looks wrong, a plain white 72 px rounded square is acceptable.

- [ ] **Step 3: Manifest**

`src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Taskeeper',
    short_name: 'Taskeeper',
    description: 'Task management for small teams',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

- [ ] **Step 4: Root layout metadata + viewport**

In `src/app/layout.tsx`:

```ts
import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegister } from '@/components/brand/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Taskeeper',
  description: 'Task management for small teams',
  appleWebApp: { capable: true, title: 'Taskeeper', statusBarStyle: 'default' },
};

// Matches the app header (bg-white-0) in each scheme; cover lets the bars pad for the notch.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#020618' },
  ],
  viewportFit: 'cover',
};
```

Render `<ServiceWorkerRegister />` right after `<TopLoadingBar />`. (Check the dark `bg-white-0` value in `globals.css`. If it isn't slate-950 `#020618`, use the real hex.)

Safe-area: in `AppHeader.tsx` add `pt-[env(safe-area-inset-top)]` and change `h-14` to `min-h-14` on the header, so the standalone iOS status bar does not cover it.

- [ ] **Step 5: Service worker**

`public/sw.js`:

```js
// Taskeeper service worker: web push, notification clicks, and an offline page for
// navigations. Nothing else is cached; every other request goes to the network as usual.
const CACHE = 'taskeeper-offline-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch {
      return (await caches.match(OFFLINE_URL)) ?? Response.error();
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON */ }
  const title = data.title || 'Taskeeper';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag,
    renotify: Boolean(data.tag),
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The service worker must never be served stale: an old one would keep old push handling.
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      ],
    }];
  },
};

export default nextConfig;
```

`src/components/brand/ServiceWorkerRegister.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

/** Registers /sw.js once per load. Production only: under next dev a worker would get in the way of hot reload. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch((error) => {
      console.error('Service worker registration failed', error);
    });
  }, []);
  return null;
}
```

- [ ] **Step 6: Offline page**

`src/app/offline/page.tsx` is static. It must not call `requireUser`, and the root layout's `headers()` read is fine since SW caching fetches it online.

```tsx
import { OfflineRetry } from './OfflineRetry';

export const metadata = { title: 'Offline · Taskeeper' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-title-h5 text-text-strong-950">You’re offline</h1>
      <p className="max-w-sm text-paragraph-sm text-text-sub-600">Taskeeper needs a connection. Check your network and try again.</p>
      <OfflineRetry />
    </main>
  );
}
```

`src/app/offline/OfflineRetry.tsx`:

```tsx
'use client';

import * as Button from '@/components/ui/button';

export function OfflineRetry() {
  return <Button.Root size="small" onClick={() => location.reload()}>Try again</Button.Root>;
}
```

Check that `offline` is not a reserved workspace slug collision. Workspace routes are `/[workspaceSlug]`, so a static `/offline` wins over the dynamic segment, but a workspace slugged `offline` becomes unreachable. Add `'offline'` to the reserved slug list, the same way `docs` was reserved in 14a (grep `'docs'` in `src/server/workspaces` or `src/lib`).

- [ ] **Step 7: e2e**

`tests/e2e/pwa.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the app is installable: manifest, icons and a service worker', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Taskeeper', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toContain('no-cache');

  await page.goto('/auth/sign-in');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test('the offline page renders without signing in', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
});
```

Run on :3100: `yarn build && PORT=3100 BETTER_AUTH_URL=http://localhost:3100 ... yarn e2e tests/e2e/pwa.spec.ts --config <temp config on 3100>`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/pwa-icons.ts public/icons public/sw.js src/app/manifest.ts src/app/layout.tsx src/app/offline src/components/brand/ServiceWorkerRegister.tsx src/components/shell/AppHeader.tsx next.config.ts package.json tests/e2e/pwa.spec.ts <reserved-slug file>
git commit -m "feat(pwa): manifest, icons, service worker and offline page"
```

---

### Task 4: Push settings card

**Files:**
- Create: `src/components/settings/PushPrefsForm.tsx`, `src/lib/push-client.ts`
- Modify: `src/app/(app)/settings/preferences/page.tsx`
- Modify: `playwright.config.ts` (test VAPID keys in `webServer.env`)
- Test: `tests/unit/push-client.test.ts`, `tests/e2e/push.spec.ts`

**Interfaces:**
- Consumes: `subscribePushAction`, `unsubscribePushAction`, `updatePushPrefsAction`, `sendTestPushAction`, `getPushPrefs`, `vapidConfig`, `PushPrefs`.
- Produces: `urlBase64ToUint8Array(base64: string): Uint8Array`, `pushSupport(env): 'ok' | 'unsupported' | 'ios-install'`.

- [ ] **Step 1: Failing pure test**

`tests/unit/push-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pushSupport, urlBase64ToUint8Array } from '@/lib/push-client';

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    expect([...urlBase64ToUint8Array('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });
});

describe('pushSupport', () => {
  const ok = { hasServiceWorker: true, hasPushManager: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', standalone: false };
  it('ok on a desktop browser with push', () => expect(pushSupport(ok)).toBe('ok'));
  it('asks iOS users to install first', () => {
    expect(pushSupport({ ...ok, hasPushManager: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('ios-install');
  });
  it('ok on iOS once installed', () => {
    expect(pushSupport({ ...ok, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', standalone: true })).toBe('ok');
  });
  it('unsupported without a service worker', () => expect(pushSupport({ ...ok, hasServiceWorker: false })).toBe('unsupported'));
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `src/lib/push-client.ts`**

```ts
/** Browser-side push helpers, kept pure so they test without a browser. */

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushEnv = { hasServiceWorker: boolean; hasPushManager: boolean; userAgent: string; standalone: boolean };

/** iOS exposes push only to home-screen apps (16.4+), so a Safari tab there means "install first". */
export function pushSupport(env: PushEnv): 'ok' | 'unsupported' | 'ios-install' {
  const ios = /iPhone|iPad|iPod/.test(env.userAgent);
  if (ios && !env.standalone) return 'ios-install';
  if (!env.hasServiceWorker || !env.hasPushManager) return 'unsupported';
  return 'ok';
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: The form**

`src/components/settings/PushPrefsForm.tsx`, in the same card style and Save-button pattern as `ReminderPrefsForm`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Switch from '@/components/ui/switch';
import type { PushPrefs } from '@/lib/push';
import { pushSupport, urlBase64ToUint8Array } from '@/lib/push-client';
import { settle } from '@/lib/settle';
import {
  sendTestPushAction, subscribePushAction, unsubscribePushAction, updatePushPrefsAction,
} from '@/server/push/actions';

type DeviceState = 'loading' | 'unconfigured' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const KINDS: Array<{ key: keyof PushPrefs; label: string; hint: string }> = [
  { key: 'reminders', label: 'Reminders', hint: 'Reminders you set on tasks.' },
  { key: 'mentions', label: 'Mentions', hint: 'When someone @mentions you.' },
  { key: 'taskChanges', label: 'Task changes', hint: 'Edits, comments and reactions on your tasks.' },
  { key: 'projectChanges', label: 'Project changes', hint: 'Projects renamed, archived or deleted.' },
];

const DEVICE_HINT: Record<DeviceState, string> = {
  loading: 'Checking this device…',
  unconfigured: 'Push is not set up on this server.',
  unsupported: 'This browser can’t receive push notifications.',
  'ios-install': 'On iPhone and iPad, add Taskeeper to your Home Screen first (Share → Add to Home Screen), then open it from there.',
  denied: 'Notifications are blocked. Allow them for this site in your browser settings.',
  off: 'Get notifications on this device, even when Taskeeper is closed.',
  on: 'This device gets push notifications.',
};

export function PushPrefsForm({ current, publicKey }: { current: PushPrefs; publicKey: string | null }) {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceState>('loading');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(current);
  const unchanged = KINDS.every(({ key }) => prefs[key] === current[key]);

  useEffect(() => {
    void (async () => {
      if (!publicKey) return setDevice('unconfigured');
      const support = pushSupport({
        hasServiceWorker: 'serviceWorker' in navigator,
        hasPushManager: 'PushManager' in window,
        userAgent: navigator.userAgent,
        standalone: matchMedia('(display-mode: standalone)').matches,
      });
      if (support !== 'ok') return setDevice(support);
      if (Notification.permission === 'denied') return setDevice('denied');
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      setDevice(subscription ? 'on' : 'off');
    })();
  }, [publicKey]);

  async function toggleDevice(on: boolean) {
    if (!publicKey) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      if (on) {
        // Asked from the tap: iOS refuses a permission prompt that no gesture started.
        if ((await Notification.requestPermission()) !== 'granted') return setDevice('denied');
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const result = await settle(subscribePushAction(subscription.toJSON()));
        if (!result.ok) {
          await subscription.unsubscribe();
          return void toast.error(result.error);
        }
        setDevice('on');
      } else {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await settle(unsubscribePushAction(subscription.endpoint));
          await subscription.unsubscribe();
        }
        setDevice('off');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not change push on this device.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    const result = await settle(updatePushPrefsAction(prefs));
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success('Push settings updated.');
    router.refresh();
  }

  async function test() {
    setBusy(true);
    const result = await settle(sendTestPushAction());
    setBusy(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(result.data.sent === 1 ? 'Test sent.' : `Test sent to ${result.data.sent} devices.`);
  }

  const switchable = device === 'on' || device === 'off';

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="push-device">Push on this device</Label.Root>
          <Hint.Root id="push-device-hint">{DEVICE_HINT[device]}</Hint.Root>
        </div>
        <Switch.Root
          id="push-device"
          aria-describedby="push-device-hint"
          checked={device === 'on'}
          onCheckedChange={toggleDevice}
          disabled={busy || !switchable}
        />
      </div>

      {KINDS.map(({ key, label, hint }) => (
        <div key={key} className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label.Root htmlFor={`push-${key}`}>{label}</Label.Root>
            <Hint.Root>{hint}</Hint.Root>
          </div>
          <Switch.Root
            id={`push-${key}`}
            checked={prefs[key]}
            onCheckedChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
            disabled={busy || !publicKey}
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button.Root size="small" onClick={save} disabled={busy || unchanged}>Save</Button.Root>
        <Button.Root size="small" variant="neutral" mode="stroke" onClick={test} disabled={busy || device !== 'on'}>
          Send test
        </Button.Root>
      </div>
    </div>
  );
}
```

Page (`settings/preferences/page.tsx`): load `getPushPrefs(ctx)` in the `Promise.all`, and add a heading plus the card after `ReminderPrefsForm`:

```tsx
      <div>
        <h3 className="text-label-md text-text-strong-950">Push notifications</h3>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Notifications on your phone or computer, even when Taskeeper is closed.</p>
      </div>
      <PushPrefsForm current={push} publicKey={vapidConfig()?.publicKey ?? null} />
```

Existing preferences e2e uses `getByRole('button', { name: 'Save' }).first()`, so the new Save button does not break it. Run that spec to confirm.

- [ ] **Step 6: e2e with test VAPID keys and a stubbed PushManager**

Generate a test-only key pair with `npx web-push generate-vapid-keys`, and add to `playwright.config.ts` `webServer.env`:

```ts
      // Test-only key pair (not used anywhere else). Pushes go to a fake endpoint and fail quietly.
      VAPID_PUBLIC_KEY: '<generated public>',
      VAPID_PRIVATE_KEY: '<generated private>',
      VAPID_SUBJECT: 'mailto:e2e@example.com',
```

`tests/e2e/push.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// Headless Chromium has no real push service: stand in for PushManager so the
// flow (permission → subscribe → server row → off) runs end to end.
test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    let current: PushSubscription | null = null;
    const fake = () => ({
      endpoint: 'https://push.example.test/e2e-device',
      toJSON: () => ({ endpoint: 'https://push.example.test/e2e-device', expirationTime: null, keys: { p256dh: 'BPx'.padEnd(87, 'x'), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { current = null; return true; },
    }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () { current = fake(); return current; };
    PushManager.prototype.getSubscription = async function () { return current; };
  });
});

test('turning push on stores this device, and per-kind toggles save', async ({ page }) => {
  // Same sign-up helper as preferences.spec.ts (copy it in; e2e files don't share helpers except tests/e2e/tasks.ts).
  await signUpWithWorkspace(page);
  await page.goto('/settings/preferences');

  const device = page.getByRole('switch', { name: 'Push on this device' });
  await expect(device).toBeEnabled();
  await device.click();
  await expect(device).toBeChecked();
  await expect(page.getByText('This device gets push notifications.')).toBeVisible();

  await page.getByRole('switch', { name: 'Project changes' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Push settings updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Project changes' })).toBeChecked();

  await device.click();
  await expect(device).not.toBeChecked();
});
```

(Copy `signUpWithWorkspace` from `preferences.spec.ts` into this file, with the email prefix `push-`.)

Run push, pwa and preferences specs on :3100. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/push-client.ts src/components/settings/PushPrefsForm.tsx "src/app/(app)/settings/preferences/page.tsx" playwright.config.ts tests/unit/push-client.test.ts tests/e2e/push.spec.ts
git commit -m "feat(push): push notifications card in Preferences"
```

---

### Task 5: Bottom tab bar + Inbox page

**Files:**
- Create: `src/components/shell/BottomBar.tsx`, `src/components/shell/NotificationList.tsx`, `src/components/shell/InboxList.tsx`, `src/app/(app)/[workspaceSlug]/inbox/page.tsx`, `src/lib/use-keyboard-open.ts`
- Modify: `src/components/shell/AppHeader.tsx`, `src/components/shell/Rail.tsx` (`MobileNav` controlled), `src/components/shell/CommandPalette.tsx` (controlled open), `src/components/shell/NotificationBell.tsx` (use `NotificationList`; phone → link), `src/components/shell/WorkspaceShell.tsx` (bottom padding), `src/components/task/TaskBulkBar.tsx` (offset), `src/app/layout.tsx` (Toaster mobile offset), `playwright.config.ts` (mobile project)
- Test: `tests/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: notifications actions (`listNotificationsAction`, `markNotificationReadAction`, `markAllNotificationsReadAction`, `clearNotificationAction`, `clearAllNotificationsAction`), `bellText`, `bellHref`, `NotificationItem`.
- Produces:
  - `MobileNav({ open, onOpenChange, ...RailProps })`
  - `CommandPalette({ open, onOpenChange, ... })`
  - `NotificationList({ workspaceSlug, items, onOpen, onClear })`
  - `useKeyboardOpen(): boolean`

- [ ] **Step 1: Mobile Playwright project**

In `playwright.config.ts`:

```ts
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    // Phone layout: iPhone 13 viewport and touch on Chromium (the only engine installed).
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /mobile\.spec\.ts/ },
  ],
```

- [ ] **Step 2: Failing e2e**

`tests/e2e/mobile.spec.ts` (copy `signUpWithWorkspace` from preferences.spec with prefix `mobile-`; it ends on the workspace page):

```ts
import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function newTask(page: Page, title: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill(title);
  const submit = dialog.getByRole('button', { name: 'Create task' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();
}

test('bottom bar: navigation, new task, search, inbox', async ({ page }) => {
  await signUpWithWorkspace(page);
  const bar = page.getByRole('navigation', { name: 'Primary' });
  await expect(bar).toBeVisible();

  await newProject(page, 'Phone');
  await newTask(page, 'Buy milk');

  await bar.getByRole('link', { name: 'To-do' }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await expect(bar.getByRole('link', { name: 'To-do' })).toHaveAttribute('aria-current', 'page');

  await bar.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('combobox').fill('milk');
  await expect(page.getByRole('option', { name: /Buy milk/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await bar.getByRole('link', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByText('Nothing yet.')).toBeVisible();
});

test('the bottom bar never covers the last list row or the bulk bar', async ({ page }) => {
  await signUpWithWorkspace(page);
  await newProject(page, 'Long');
  for (let i = 1; i <= 12; i++) await newTask(page, `Row ${i}`);
  await page.getByRole('link', { name: 'List' }).click();
  const last = page.getByRole('button', { name: 'Row 12', exact: true });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('checkbox', { name: 'Select Row 1' }).check();
  const bulk = page.getByRole('toolbar');
  const barBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  const bulkBox = await bulk.boundingBox();
  expect(bulkBox!.y + bulkBox!.height).toBeLessThanOrEqual(barBox!.y);
});
```

(Check the bulk bar's role/label in `TaskBulkBar.tsx`, the List tab's role in `ViewTabs`, and the palette's input role, and adjust the locators. Create-project dialog labels come from `NewProjectDialog.tsx`.)

Run on :3100 with `--project mobile`. Expected: FAIL (no Primary nav).

- [ ] **Step 3: Controlled MobileNav and CommandPalette**

`Rail.tsx`:

```tsx
export function MobileNav({ open, onOpenChange, ...props }: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      {/* trigger unchanged */}
      <Drawer.Content ...>
        ...
        <div className="h-full" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) onOpenChange(false); }}>
```

(Drop its local `useState`.)

`CommandPalette.tsx`: replace `const [open, setOpen] = useState(false);` with props `open: boolean; onOpenChange: (open: boolean) => void`. The existing internal `onOpenChange(next)` that resets term/results becomes `change(next)`: it calls the prop, and on close resets the local state. Every former `setOpen(x)` becomes `change(x)`.

- [ ] **Step 4: Shared notification list**

Move the `<ul>…</ul>` body from `NotificationBell` into `NotificationList.tsx`:

```tsx
'use client';

import { IconX } from '@tabler/icons-react';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { BELL_CHANGE_CLASSES, BELL_EMPTY_CLASSES, bellTransitionName } from '@/lib/motion';
import { bellHref, bellText } from '@/lib/notifications';
import type { NotificationItem } from '@/server/notifications/queries';
import { cn } from '@/utils/cn';

/** The bell's rows, shared by its popover and the Inbox page. */
export function NotificationList({ workspaceSlug, items, onOpen, onClear, className }: {
  workspaceSlug: string;
  items: NotificationItem[] | null;
  onOpen: (item: NotificationItem) => void;
  onClear: (item: NotificationItem) => void;
  className?: string;
}) {
  return (
    <ul className={cn('p-1', className)} aria-label="Notifications">
      {/* …exact markup moved from NotificationBell: Loading…, Nothing yet., rows with Link + clear button,
          with onClick={() => onOpen(item)} and onClick={() => onClear(item)} … */}
    </ul>
  );
}
```

In `NotificationBell`, render `<NotificationList workspaceSlug={workspaceSlug} items={items} onOpen={markOne} onClear={clearOne} className="max-h-96 overflow-y-auto" />`. Keep the bell's header (Mark all read / Clear all) in the bell.

Below `sm` the header bell becomes a link to Inbox. Wrap the existing Popover so `Popover.Root` and its trigger show from `sm`, and add a sibling:

```tsx
<CompactButton.Root asChild variant="ghost" size="large" className="relative sm:hidden">
  <Link href={`/${workspaceSlug}/inbox`} aria-label={label}>…same icon + badge…</Link>
</CompactButton.Root>
```

with the popover trigger getting `max-sm:hidden`. Toasts and their effect stay in the bell, which is mounted at every width.

- [ ] **Step 5: Inbox page**

`src/components/shell/InboxList.tsx`: a client component holding `items` state (initial from server), with the same `markRead`/`markAll`/`clearOne`/`clearAll` logic as the bell. Copy those four handlers; each also calls `router.refresh()` after success so the header and bottom-bar badges update. Header row: `h1` "Inbox" plus the Mark all read and Clear all buttons.

`src/app/(app)/[workspaceSlug]/inbox/page.tsx`:

```tsx
import { InboxList } from '@/components/shell/InboxList';
import { requireWorkspace } from '@/lib/session';
import { listNotifications } from '@/server/notifications/queries';

export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const items = await listNotifications(ctx, 50);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-8">
      <InboxList workspaceSlug={workspaceSlug} initialItems={items} />
    </main>
  );
}
```

Add `'inbox'` to the reserved workspace-slug list if one exists. Workspace slugs are at `/[slug]`, not `/[slug]/inbox`, so this is only needed if sub-route names are reserved too. Check how `todo`/`calendar` are handled; if they aren't reserved, skip this.

- [ ] **Step 6: Keyboard hook**

`src/lib/use-keyboard-open.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';

/** True while an on-screen keyboard takes a big share of the screen (the visual viewport shrinks, the layout one doesn't). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);
  return open;
}
```

- [ ] **Step 7: BottomBar**

`src/components/shell/BottomBar.tsx`:

```tsx
'use client';

import { IconBell, IconChecklist, IconFolders, IconPlus, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useKeyboardOpen } from '@/lib/use-keyboard-open';
import { cn } from '@/utils/cn';

const SLOT = 'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-label-xs';

/** Phone and tablet navigation (below lg): the daily loop within thumb reach. */
export function BottomBar({ workspaceSlug, unread, canCreate, onProjects, onNewTask, onSearch }: {
  workspaceSlug: string;
  unread: number;
  canCreate: boolean;
  onProjects: () => void;
  onNewTask: () => void;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const keyboard = useKeyboardOpen();
  const todo = `/${workspaceSlug}/todo`;
  const inbox = `/${workspaceSlug}/inbox`;
  const tone = (active: boolean) => (active ? 'text-primary-base' : 'text-text-sub-600');

  if (keyboard) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-stroke-soft-200 bg-bg-white-0/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <button type="button" onClick={onProjects} className={cn(SLOT, tone(false))}>
        <IconFolders className="size-5" aria-hidden="true" />
        Projects
      </button>
      <Link href={todo} aria-current={pathname === todo ? 'page' : undefined} className={cn(SLOT, tone(pathname === todo))}>
        <IconChecklist className="size-5" aria-hidden="true" />
        To-do
      </Link>
      <button type="button" onClick={onNewTask} disabled={!canCreate} aria-label="New task" className={cn(SLOT, 'disabled:opacity-40')}>
        <span className="flex size-10 items-center justify-center rounded-full bg-primary-base text-static-white shadow-regular-sm">
          <IconPlus className="size-5" aria-hidden="true" />
        </span>
      </button>
      <button type="button" onClick={onSearch} className={cn(SLOT, tone(false))}>
        <IconSearch className="size-5" aria-hidden="true" />
        Search
      </button>
      <Link href={inbox} aria-current={pathname === inbox ? 'page' : undefined} className={cn(SLOT, 'relative', tone(pathname === inbox))}>
        <IconBell className="size-5" aria-hidden="true" />
        Inbox
        {unread > 0 && (
          <span className="tabular absolute right-[calc(50%-1.25rem)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-base px-1 text-[0.625rem] font-medium text-static-white">
            {unread > 9 ? '9+' : unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </Link>
    </nav>
  );
}
```

- [ ] **Step 8: Wire into AppHeader**

`AppHeader` returns a fragment. The header's `backdrop-blur` would make it the containing block for a fixed child, so the bar renders as a sibling, outside `<header>`:

```tsx
  const [navOpen, setNavOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  return (
    <>
      <header …>
        <MobileNav {...props} open={navOpen} onOpenChange={setNavOpen} />
        … <CommandPalette open={searching} onOpenChange={setSearching} … />
        …
      </header>
      <BottomBar
        workspaceSlug={props.workspaceSlug}
        unread={unread}
        canCreate={canCreate}
        onProjects={() => setNavOpen(true)}
        onNewTask={() => setCreating(true)}
        onSearch={() => setSearching(true)}
      />
    </>
  );
```

`WorkspaceShell`: content column `className="flex min-w-0 flex-1 flex-col max-lg:pb-[calc(3.5rem+env(safe-area-inset-bottom))]"`.

`TaskBulkBar`: change `bottom-6` to `bottom-6 max-lg:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`.

Root layout Toaster: `<Toaster position="bottom-right" mobileOffset={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }} />`. Check that `src/components/ui/toaster.tsx` forwards props to sonner's `Toaster` and that the installed sonner supports `mobileOffset`; if not, use `offset`, given only below `lg` via a `useMediaQuery`-free CSS var.

`AppHeader` is also used on account settings pages (via `WorkspaceShell`), so the bar shows there too. That's fine: the slots link to the remembered workspace's slug, which `props.workspaceSlug` already is.

- [ ] **Step 9: Run e2e (mobile + desktop smoke), expect PASS**

Run on :3100: `mobile.spec.ts` on project `mobile`, and `search.spec.ts create-task.spec.ts change-notifications.spec.ts shortcuts.spec.ts list-bulk.spec.ts` on `chromium` (the palette, bell and bulk bar changed).

- [ ] **Step 10: Commit**

```bash
git add src/components/shell src/lib/use-keyboard-open.ts "src/app/(app)/[workspaceSlug]/inbox" src/components/task/TaskBulkBar.tsx src/app/layout.tsx playwright.config.ts tests/e2e/mobile.spec.ts
git commit -m "feat(mobile): bottom tab bar and Inbox page"
```

---

### Task 6: Views on the phone

**Files:**
- Modify: `src/components/board/Board.tsx` (snap, `moveTo`), `src/components/board/BoardColumn.tsx` (width, pass statuses/onMoveTo), `src/components/board/TaskCard.tsx` (Move to… menu)
- Modify: `src/components/task/TaskTable.tsx` (stacked rows below `sm`)
- Create: `src/components/calendar/CalendarAgenda.tsx`; Modify: `src/components/calendar/CalendarMonth.tsx` (use it)
- Modify: `src/app/(app)/[workspaceSlug]/projects/[projectId]/summary/page.tsx` (single column)
- Modify: `src/components/todo/TodoList.tsx` (sensors)
- Test: `tests/unit/board-neighbours.test.ts` (or the existing neighbours test file), `tests/e2e/mobile.spec.ts` (append)

**Interfaces:**
- Consumes: `moveTaskAction(workspaceSlug, { taskId, statusId, beforeId, afterId })`, `StatusRow`, `CalendarTask`, `CalendarChip`-style row data.
- Produces: `appendTo(items, taskId, statusId): { statusId; beforeId: string | null; afterId: null } | null` in `src/components/board/neighbours.ts`.

- [ ] **Step 1: Failing unit test for the append target**

Add to the existing neighbours test file, or create `tests/unit/board-neighbours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { appendTo, columnId } from '@/components/board/neighbours';

const items = [
  { id: 'a', column: columnId('todo') },
  { id: 'b', column: columnId('done') },
  { id: 'c', column: columnId('done') },
];

describe('appendTo', () => {
  it('puts the card after the last card of the target column', () => {
    expect(appendTo(items, 'a', 'done')).toEqual({ statusId: 'done', beforeId: 'c', afterId: null });
  });
  it('an empty column has no neighbours', () => {
    expect(appendTo(items, 'b', 'review')).toEqual({ statusId: 'review', beforeId: null, afterId: null });
  });
  it('null when the card is already there', () => {
    expect(appendTo(items, 'b', 'done')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement in `neighbours.ts`**

```ts
/** "Move to…": the end of another column, in moveTaskAction's shape. Null when the card is already in it. */
export function appendTo<T extends Positioned>(items: T[], taskId: string, statusId: string) {
  const moved = items.find((i) => i.id === taskId);
  if (!moved || moved.column === columnId(statusId)) return null;
  const column = items.filter((i) => i.column === columnId(statusId) && i.id !== taskId);
  return { statusId, beforeId: column[column.length - 1]?.id ?? null, afterId: null };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Board UI**

`Board.tsx`: add

```ts
  function moveTo(taskId: string, statusId: string) {
    const target = appendTo(baseItems, taskId, statusId);
    if (!target) return;
    const statusName = statuses.find((s) => s.id === statusId)?.name ?? 'column';
    const input = { taskId, ...target };
    const index = baseItems.filter((i) => i.column === columnId(statusId)).length;
    setAnnouncement(`Moved to ${statusName}.`);
    startTransition(async () => {
      applyMove({ taskId, statusId, index });
      const result = await settle(moveTaskAction(workspaceSlug, input));
      if (!result.ok) toast.error(result.error);
      else if (hiddenStatusIds.includes(statusId)) toast(`Moved to ${statusName} — hidden by the current filter.`);
      router.refresh();
    });
  }
```

Pass `statuses` and `onMoveTo={moveTo}` through `BoardColumn` to `TaskCard`. Provider className becomes `"flex flex-1 gap-3 overflow-x-auto px-4 pt-4 pb-4 lg:px-6 max-sm:snap-x max-sm:snap-proximity max-sm:scroll-px-4"`. Proximity, not mandatory: mandatory snapping fights dnd-kit's auto-scroll during a long-press drag. `BoardColumn`'s `KanbanBoard` className becomes `"w-[85vw] shrink-0 snap-start sm:w-[280px]"`.

`TaskCard.tsx`: add a menu button in the card's bottom row, before the avatar, shown on touch devices and on hover/focus elsewhere:

```tsx
<Dropdown.Root>
  <Dropdown.Trigger asChild>
    <CompactButton.Root
      variant="ghost"
      size="medium"
      aria-label={`Move ${task.title}`}
      // Not a drag handle: keep the press from reaching dnd-kit's sensors, and the click from opening the task.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 max-sm:size-11"
    >
      <CompactButton.Icon as={IconArrowsRightLeft} />
    </CompactButton.Root>
  </Dropdown.Trigger>
  <Dropdown.Content align="end">
    <Dropdown.Label>Move to</Dropdown.Label>
    {statuses.filter((s) => s.id !== task.statusId).map((s) => (
      <Dropdown.Item key={s.id} onSelect={() => onMoveTo(task.id, s.id)}>
        <StatusIcon status={s} /> {s.name}
      </Dropdown.Item>
    ))}
  </Dropdown.Content>
</Dropdown.Root>
```

Check `src/components/ui/dropdown.tsx` for the exact exports (`Root/Trigger/Content/Item/Label`), check `StatusIcon`'s props, and check whether `KanbanCard` renders with a `group` class (if not, add `group` via its className). Also check that `KanbanCard`'s onClick ignores clicks from inside the menu. The `stopPropagation` above covers the trigger, and menu items render in a portal.

- [ ] **Step 6: List stacked rows**

In `TaskTable.tsx`, give the wrapper `<div className="relative overflow-x-auto">` the class `max-sm:hidden`, and add a sibling list for phones that reuses `rows`, `selection`, `toggleRow`, `openTask` and `statusById`:

```tsx
<ul className="flex flex-col gap-1 sm:hidden" aria-label="Tasks">
  {rows.map((row) => {
    const t = row.original;
    const selected = selection.has(row.id);
    const status = statusById.get(t.statusId);
    return (
      <li key={row.id} className={cn('flex items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-inset ring-stroke-soft-200', selected && 'bg-primary-lighter')}>
        <SelectBox label={`Select ${t.title}`} checked={selected} onClick={(e) => { e.stopPropagation(); toggleRow(row.id, false); }} />
        <button type="button" onClick={() => openTask(t.id)} data-task-nav={t.id} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
          {status && <StatusIcon status={status} />}
          <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">{t.title}</span>
          <DueChip dueDate={t.dueDate} timezone={timezone} done={t.completedAt !== null} />
          {t.assigneeName && <AssigneeAvatar name={t.assigneeName} image={t.assigneeImage} />}
        </button>
      </li>
    );
  })}
</ul>
```

`TaskTableSettings` (columns/density) has no effect on the phone list. Hide its trigger below `sm` (`max-sm:hidden` on the wrapping `div.mb-3`). The mobile e2e in Task 5 uses `getByRole('button', { name: 'Row 12', exact: true })`. On a phone the table is `display:none`, so only the list button matches. Desktop specs are unchanged, because the list is `sm:hidden`.

- [ ] **Step 7: Calendar agenda**

`src/components/calendar/CalendarAgenda.tsx`, extracted from the `<ol className="... sm:hidden">` block in `CalendarMonth`, with richer rows:

```tsx
'use client';

import { projectDot } from '@/components/brand/tint';
import { StatusIcon } from '@/components/task/StatusIcon';
import { formatDueDate } from '@/lib/dates';
import type { CalendarTask } from '@/server/tasks/calendar';
import { cn } from '@/utils/cn';

/** Phone view of a month: only the days with tasks, as a list. No drag; the due date changes in the task. */
export function CalendarAgenda({ days, byDay, today, showProject, onOpen }: {
  days: string[];
  byDay: Map<string, CalendarTask[]>;
  today: string;
  showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const shown = days.filter((d) => byDay.has(d));
  if (shown.length === 0) {
    return <p className="py-8 text-center text-paragraph-sm text-text-sub-600 sm:hidden">No tasks due this month.</p>;
  }
  return (
    <ol className="flex flex-col gap-4 sm:hidden" aria-label="Tasks by day">
      {shown.map((day) => (
        <li key={day}>
          <h3 className={cn('mb-1 text-label-sm', day === today ? 'text-primary-base' : 'text-text-sub-600')}>
            {formatDueDate(day, 'UTC', new Date(`${today}T12:00:00Z`))}
          </h3>
          <ul className="flex flex-col gap-1">
            {byDay.get(day)!.map((t) => {
              const overdue = !t.isDone && t.dueDate < today;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(t)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-paragraph-sm ring-1 ring-inset ring-stroke-soft-200',
                      overdue && 'bg-error-lighter',
                    )}
                  >
                    {/* …status icon and project dot exactly as CalendarChip renders them (copy its markup)… */}
                    <span className={cn('min-w-0 flex-1 truncate', t.isDone && 'line-through text-text-soft-400')}>{t.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
```

Replace the old `<ol>` in `CalendarMonth` with `<CalendarAgenda days={weeks.flat().filter(inMonth)} byDay={byDay} today={today} showProject={showProject} onOpen={open} />`. Before writing the comment placeholder above, read `CalendarChip.tsx` in full. It shows how a chip renders status and project, so reproduce that markup in the button instead of leaving the comment.

- [ ] **Step 8: Summary single column, To-do sensors**

Summary page: `grid grid-cols-2 gap-3 lg:grid-cols-4` → `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`. The second grid (`mt-6 grid gap-3 lg:grid-cols-2`) is already one column below `lg`.

`TodoList.tsx`:

```ts
  const sensors = useSensors(
    // Mouse + Touch, not Pointer: a PointerSensor also answers touch and starts a drag on every swipe (as on the board).
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
```

(Update the `@dnd-kit/core` import.) Run `tests/e2e/todo.spec.ts` on desktop. Its drag test uses the mouse, which now needs 8 px of movement before a drag starts. If it drags with `mouse.move` in one step, add `{ steps: 10 }`.

- [ ] **Step 9: Append e2e**

Add to `tests/e2e/mobile.spec.ts`:

```ts
test('board, calendar and task detail on a phone', async ({ page }) => {
  await signUpWithWorkspace(page);
  await newProject(page, 'Views');
  await newTask(page, 'Card one');

  await page.getByRole('link', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'Move Card one' }).click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await expect(page.getByRole('region', { name: 'Done' }).getByText('Card one')).toBeVisible();

  // Task detail: fields come before the description on a phone.
  await page.getByText('Card one').click();
  const details = page.getByRole('dialog', { name: 'Task details' });
  const status = await details.getByLabel('Status').boundingBox();
  const description = await details.getByText('Description').first().boundingBox();
  expect(status!.y).toBeLessThan(description!.y);
  await page.keyboard.press('Escape');

  // Agenda: give the task a due date today, then the calendar lists it.
  // (Set it in the detail's Due date field like calendar.spec.ts does; reuse its steps.)
  await page.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('list', { name: 'Tasks by day' }).getByText('Card one')).toBeVisible();
});
```

(Check the default status names, the board column's accessible role/name in `kibo-ui/kanban`, the detail's Description label, and how `calendar.spec.ts` sets a due date; adjust the locators.)

Run on :3100: `mobile.spec.ts` (mobile), and `board.spec.ts board-drag.spec.ts calendar.spec.ts list-bulk.spec.ts todo.spec.ts views.spec.ts` (chromium). Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/board src/components/task/TaskTable.tsx src/components/calendar "src/app/(app)/[workspaceSlug]/projects/[projectId]/summary/page.tsx" src/components/todo/TodoList.tsx tests/unit/board-neighbours.test.ts tests/e2e/mobile.spec.ts
git commit -m "feat(mobile): phone layouts for board, list, calendar, summary and to-do"
```

---

### Task 7: Docs, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-mobile-pwa-design.md` (plan decisions 1–6)
- Modify: `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md` (14b line)
- Modify: `.env.example` (VAPID block)

- [ ] **Step 1: Spec text**

Make these edits in the spec:
- §4.2.3 url: "the bell's link (`bellHref`)".
- §4.1: "one `after()` per insert call".
- §5.3 Calendar row: "the existing CSS switch (`sm:hidden` / `hidden sm:flex`); no `useMediaQuery`".
- §5.3 List row: "a checkbox per row; no long-press".
- §5.3 Task detail row: "already stacked below `lg`; verified by e2e".
- §5.1: add "Toaster and bulk bar lifted above the bar below `lg`".

- [ ] **Step 2: Roadmap + env example**

Roadmap 14b line: "**14b Mobile** (`feat/mobile-pwa`, 2026-10-13): installable PWA, bottom tab bar + Inbox, phone layouts, web push with per-kind toggles. Native app / bearer sessions stay parked." `.env.example`:

```
# Web push (Account → Preferences → Push). Generate once per environment:
#   npx web-push generate-vapid-keys
# Leave empty to turn push off.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

- [ ] **Step 3: Full verification**

Run: `yarn typecheck && yarn lint && yarn test`. Expected: all green, and the count is above the previous 1156.
Run the full e2e on :3100, both projects. Expected: all green. Report any failure with its output; don't paper over it.

- [ ] **Step 4: Graph + commit**

```bash
graphify update .
git add docs .env.example
git commit -m "docs(mobile): roadmap, env example and spec notes for the PWA"
```

- [ ] **Step 5: Hand-off notes (for the PR body, when the user asks for the PR)**

- Run `yarn db:setup:dev` / `yarn db:setup:prod` BEFORE deploying (`push_subscription` table, 4 `user_settings` columns).
- Generate VAPID keys per Vercel environment and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
- Check prod for workspaces slugged `offline` (now reserved).
- Manual check owed: install on a real iPhone (iOS 16.4+) and an Android phone, turn push on, have a teammate @mention you, and tap the notification to open the task.
