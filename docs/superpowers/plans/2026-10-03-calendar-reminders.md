# Calendar view + reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A month calendar (per project and "My calendar") where dragging a task reschedules it, plus a cron that sends daily digests and personal per-task reminders by email and into an in-app bell, at most once each.

**Architecture:** Two new tables (`reminder`, `notification`) and two `user_settings` columns. A system job `runReminders(now)` selects due items in SQL (Postgres does all timezone math), claims each with `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`, then emails unsent rows under an atomic `FOR UPDATE SKIP LOCKED` claim. The calendar is our own month grid built from Align UI atoms and dnd-kit; drops call the existing `updateTaskAction`.

**Tech Stack:** Next.js 16 (App Router, server actions), drizzle-orm 0.45 / drizzle-kit 0.31 on Postgres, react-email 6 + Resend, @dnd-kit/core 6.3, Align UI (Button, CompactButton, Popover, Dropdown, Switch, Select), Tabler icons, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-calendar-reminders-design.md`

## Global Constraints

- Reminder offsets are exactly `0, 1, 2, 7` (days before the due date). Labels: "On the day", "1 day before", "2 days before", "7 days before".
- Default reminder hour `9`; hours are integers `0–23`. `digest_enabled` defaults to `true`.
- Lookback window `36 hours`; email retry cap `3` attempts; email lock `10 minutes`; at most `500` emails per run; digest task list cap `20`; bell lists latest `30`.
- Dedupe keys: `rem:{taskId}:{userId}:{dueDate}:{offsetDays}` and `dig:{userId}:{workspaceId}:{localDate}`.
- Zone = `coalesce(user_settings.timezone, workspace_settings.timezone, 'Asia/Yerevan')`; only zones present in `pg_timezone_names` are used.
- `vercel.json` cron for reminders: `0 6 * * *`. `REMINDER_CRON_HOURLY = false`.
- Calendar range is always 6 weeks (42 days); `listCalendarTasks` rejects ranges over 42 days.
- Dates stay `YYYY-MM-DD` strings through `src/lib/dates.ts`; never compare due dates as `Date`s.
- `ctx: WorkspaceContext` first on every `src/server/**` export (`UserContext` for account-level; the cron job `runReminders` and its helpers are system jobs with no ctx, like `sweepAttachments`). Recipient/actor always from `ctx.userId`, never input.
- `Result<T>` across every action boundary (`withAction`). Action files take a slug, never a ctx.
- New tables go in the `TRUNCATE` list in `tests/setup/db.ts`.
- Tabler icons only (`@tabler/icons-react`); semantic Align tokens only (no raw colors).
- Commits: Conventional Commits, plain messages, **no `Co-Authored-By` trailer**. Never push. Never change versions.
- Next.js here has breaking changes — check `node_modules/next/dist/docs/` before using any Next API not already used in the files you touch.
- Run `yarn db:setup:test` after any schema change before running server tests (and `yarn db:setup` for the dev DB).

## Review Focus

1. **A stored timezone Postgres doesn't know, or a raw offset like `+04:00`** — must not crash the whole cron (one bad row would fail every send) and must not shift sends by the sign-flipped POSIX offset. Pinned in Task 1 (`isValidTimezone` rejects offsets) and Task 3 (row with `Mars/Olympus` is skipped, others still sent).
2. **Reminder hour late in the day on the daily schedule** (e.g. 23:00 Yerevan with the cron at 06:00 UTC) — the digest must still go out once per day, not never. Pinned in Task 3 (digest date falls back to yesterday).
3. **Due date moved after a reminder already fired** — fires again for the new date; moving it back to the original date does not resend. Pinned in Task 3 (dedupe key includes the due date).
4. **Resend failing mid-batch** — remaining rows still go out, failed row retries on a later run and stops after 3. Pinned in Task 4.
5. **Dragging a chip onto the day it is already on, or dropping outside the grid** — no write, no toast. Pinned in Task 7 (`dropTarget` unit test) and the e2e in Task 9.

---

### Task 1: Schema, reminder constants, and reminder preferences service

**Files:**
- Create: `src/db/schema/reminder.ts`
- Create: `src/lib/reminders.ts`
- Modify: `src/db/schema/settings.ts` (add two columns to `userSettings`)
- Modify: `src/db/schema/index.ts` (export `./reminder`)
- Modify: `src/lib/dates.ts:111-118` (`isValidTimezone`)
- Modify: `src/server/user-settings/service.ts` (add `getReminderPrefs`, `updateReminderPrefs`)
- Modify: `src/server/user-settings/actions.ts` (add `updateReminderPrefsAction`)
- Modify: `tests/setup/db.ts` (TRUNCATE list)
- Test: `tests/unit/reminders.test.ts` (create), `tests/unit/dates.test.ts` (extend), `tests/server/user-settings.test.ts` (extend + fix exact-row assertion), `tests/server/reminder-schema.test.ts` (create)

**Interfaces:**
- Produces (`src/lib/reminders.ts`, pure, client-safe):
  - `REMINDER_OFFSETS = [0, 1, 2, 7] as const`, `type ReminderOffset = 0 | 1 | 2 | 7`, `isReminderOffset(n: unknown): n is ReminderOffset`
  - `OFFSET_LABEL: Record<ReminderOffset, string>`
  - `DEFAULT_REMINDER_HOUR = 9`, `REMINDER_CRON_HOURLY = false`, `DIGEST_TASK_CAP = 20`
  - `type ReminderData = { title: string; projectName: string; dueDate: string; offsetDays: ReminderOffset }`
  - `type DigestData = { localDate: string; dueToday: number; overdue: number; tasks: { id: string; title: string; dueDate: string }[] }`
  - `type NotificationData = ReminderData | DigestData`
  - `reminderKey(taskId, userId, dueDate, offsetDays): string`, `digestKey(userId, workspaceId, localDate): string`
  - `dueInLabel(offsetDays: number): string`, `reminderSubject(d: ReminderData): string`, `digestSubject(d: DigestData, workspaceName: string): string`, `hourLabel(hour: number): string`
- Produces (schema): `reminder`, `notification`, `notificationKind` tables/enum; `userSettings.reminderHour`, `userSettings.digestEnabled`
- Produces: `getReminderPrefs(ctx: UserContext): Promise<ReminderPrefs>`, `updateReminderPrefs(ctx: UserContext, input: ReminderPrefs): Promise<Result<null>>`, `type ReminderPrefs = { reminderHour: number; digestEnabled: boolean }`, `updateReminderPrefsAction(input: ReminderPrefs): Promise<Result<null>>`

- [ ] **Step 1: Write failing unit tests for `src/lib/reminders.ts`**

`tests/unit/reminders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  digestKey, digestSubject, dueInLabel, hourLabel, isReminderOffset, reminderKey, reminderSubject,
} from '@/lib/reminders';

describe('dedupe keys', () => {
  it('keys a reminder on task, user, due date and offset', () => {
    expect(reminderKey('t1', 'u1', '2026-10-10', 1)).toBe('rem:t1:u1:2026-10-10:1');
  });

  it('keys a digest on user, workspace and local date', () => {
    expect(digestKey('u1', 'w1', '2026-10-10')).toBe('dig:u1:w1:2026-10-10');
  });
});

describe('copy', () => {
  it('says today, tomorrow, or in N days', () => {
    expect(dueInLabel(0)).toBe('today');
    expect(dueInLabel(1)).toBe('tomorrow');
    expect(dueInLabel(7)).toBe('in 7 days');
  });

  it('builds the reminder subject with curly quotes', () => {
    expect(reminderSubject({ title: 'Ship v2', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 1 }))
      .toBe('“Ship v2” is due tomorrow');
  });

  it('builds the digest subject from the non-zero counts', () => {
    const base = { localDate: '2026-10-10', tasks: [] };
    expect(digestSubject({ ...base, dueToday: 3, overdue: 2 }, 'Acme')).toBe('3 due today · 2 overdue in Acme');
    expect(digestSubject({ ...base, dueToday: 0, overdue: 1 }, 'Acme')).toBe('1 overdue in Acme');
    expect(digestSubject({ ...base, dueToday: 1, overdue: 0 }, 'Acme')).toBe('1 due today in Acme');
  });

  it('formats an hour as HH:00', () => {
    expect(hourLabel(9)).toBe('09:00');
    expect(hourLabel(23)).toBe('23:00');
  });
});

describe('isReminderOffset', () => {
  it('accepts only 0, 1, 2 and 7', () => {
    expect([0, 1, 2, 7].every(isReminderOffset)).toBe(true);
    expect([3, -1, 1.5, '1', null].some(isReminderOffset)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `yarn vitest run tests/unit/reminders.test.ts`

- [ ] **Step 3: Implement `src/lib/reminders.ts`**

```ts
/**
 * Reminder and digest constants, payload types and copy. Pure, so the cron,
 * the emails, the bell and the task dialog all read the same values.
 */

export const REMINDER_OFFSETS = [0, 1, 2, 7] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const OFFSET_LABEL: Record<ReminderOffset, string> = {
  0: 'On the day',
  1: '1 day before',
  2: '2 days before',
  7: '7 days before',
};

export const DEFAULT_REMINDER_HOUR = 9;

/**
 * False while vercel.json runs the reminders cron once a day (Vercel Hobby).
 * Flip together with the schedule ("0 * * * *") after moving to Pro.
 */
export const REMINDER_CRON_HOURLY = false;

export const DIGEST_TASK_CAP = 20;

export type ReminderData = { title: string; projectName: string; dueDate: string; offsetDays: ReminderOffset };
export type DigestData = {
  localDate: string;
  dueToday: number;
  overdue: number;
  tasks: { id: string; title: string; dueDate: string }[];
};
export type NotificationData = ReminderData | DigestData;

export function isReminderOffset(n: unknown): n is ReminderOffset {
  return typeof n === 'number' && (REMINDER_OFFSETS as readonly number[]).includes(n);
}

/** The due date is part of the key, so moving the date makes the reminder fire again. */
export function reminderKey(taskId: string, userId: string, dueDate: string, offsetDays: number): string {
  return `rem:${taskId}:${userId}:${dueDate}:${offsetDays}`;
}

export function digestKey(userId: string, workspaceId: string, localDate: string): string {
  return `dig:${userId}:${workspaceId}:${localDate}`;
}

export function dueInLabel(offsetDays: number): string {
  if (offsetDays === 0) return 'today';
  if (offsetDays === 1) return 'tomorrow';
  return `in ${offsetDays} days`;
}

export function reminderSubject(d: ReminderData): string {
  return `“${d.title}” is due ${dueInLabel(d.offsetDays)}`;
}

export function digestSummary(d: Pick<DigestData, 'dueToday' | 'overdue'>): string {
  const parts: string[] = [];
  if (d.dueToday > 0) parts.push(`${d.dueToday} due today`);
  if (d.overdue > 0) parts.push(`${d.overdue} overdue`);
  return parts.join(' · ');
}

export function digestSubject(d: DigestData, workspaceName: string): string {
  return `${digestSummary(d)} in ${workspaceName}`;
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
```

- [ ] **Step 4: Run unit tests, expect PASS**

Run: `yarn vitest run tests/unit/reminders.test.ts`

- [ ] **Step 5: Write failing test for the stricter `isValidTimezone`**

Append inside `describe('isValidTimezone')` in `tests/unit/dates.test.ts`:

```ts
  it('rejects raw offsets, which Postgres would read with the sign flipped', () => {
    expect(isValidTimezone('+04:00')).toBe(false);
    expect(isValidTimezone('-0700')).toBe(false);
  });

  it('still accepts Etc zones and multi-part names', () => {
    expect(isValidTimezone('Etc/GMT+4')).toBe(true);
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
  });
```

Run: `yarn vitest run tests/unit/dates.test.ts` — expect FAIL on the offset case.

- [ ] **Step 6: Tighten `isValidTimezone` in `src/lib/dates.ts`**

Replace the function body:

```ts
export function isValidTimezone(tz: string): boolean {
  // Region/City names (and UTC) only. Intl also accepts raw offsets like
  // "+04:00", but Postgres reads those as POSIX zones with the sign flipped,
  // so a reminder would go out eight hours off.
  if (tz !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

Run: `yarn vitest run tests/unit/dates.test.ts tests/unit/timezones.test.ts` — expect PASS.

- [ ] **Step 7: Add the schema**

`src/db/schema/settings.ts` — add `boolean, check` to the `drizzle-orm/pg-core` import, `import { sql } from 'drizzle-orm';`, and replace `userSettings`:

```ts
// Per-user preferences that are not workspace-scoped. A null timezone means
// "follow each workspace's zone"; resolveWorkspace applies the fallback.
export const userSettings = pgTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone'),
    // Local hour (0–23) for the daily digest and per-task reminders.
    reminderHour: smallint('reminder_hour').notNull().default(9),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
  },
  (t) => [check('user_settings_reminder_hour_ck', sql`${t.reminderHour} between 0 and 23`)],
);
```

`src/db/schema/reminder.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  check, index, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { NotificationData } from '@/lib/reminders';
import { organization, user } from './auth';
import { task } from './task';

// A personal reminder: the user who set it is the one told (spec: Per-task reminders).
export const reminder = pgTable(
  'reminder',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    offsetDays: smallint('offset_days').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reminder_task_user_offset_uq').on(t.taskId, t.userId, t.offsetDays),
    check('reminder_offset_days_ck', sql`${t.offsetDays} in (0, 1, 2, 7)`),
  ],
);

export const notificationKind = pgEnum('notification_kind', ['digest', 'reminder']);

// One bell item, and the cron's idempotency claim: dedupe_key is unique, so a
// second run inserting the same key does nothing.
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull().unique(),
    // Display snapshot, so a later rename does not rewrite history and the bell needs no join.
    data: jsonb('data').$type<NotificationData>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailClaimedAt: timestamp('email_claimed_at', { withTimezone: true }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailAttempts: smallint('email_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_bell_idx').on(t.userId, t.workspaceId, t.createdAt),
    index('notification_unsent_idx').on(t.createdAt).where(sql`${t.emailSentAt} is null`),
  ],
);
```

`src/db/schema/index.ts` — append `export * from './reminder';`.

`tests/setup/db.ts` — the TRUNCATE list becomes:

```ts
    TRUNCATE TABLE
      notification, reminder,
      attachment, todo, project_star, comment, task_activity,
      task_label, task, task_status, label, project,
      workspace_settings, user_settings, invitation, member, organization,
      session, account, verification, rate_limit, "user"
    RESTART IDENTITY CASCADE
```

Run: `yarn db:setup:test && yarn db:setup` — expect both to apply without prompts. If drizzle-kit asks about the new enum or columns, answer "create".

- [ ] **Step 8: Write failing schema tests**

`tests/server/reminder-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { notification, reminder, task } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('rs@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-rs');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-rs', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T', dueDate: '2026-10-10' });
  if (!made.ok) throw new Error();
  return { ctx, taskId: made.data.id };
}

describe('reminder table', () => {
  it('rejects an offset outside 0, 1, 2, 7', async () => {
    const { ctx, taskId } = await setup();
    await expect(
      db.insert(reminder).values({ id: newId(), workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 3 }),
    ).rejects.toThrow();
  });

  it('allows one row per task, user and offset', async () => {
    const { ctx, taskId } = await setup();
    const row = { workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 1 };
    await db.insert(reminder).values({ id: newId(), ...row });
    await expect(db.insert(reminder).values({ id: newId(), ...row })).rejects.toThrow();
  });

  it('goes away with its task, and takes the task’s notifications with it', async () => {
    const { ctx, taskId } = await setup();
    await db.insert(reminder).values({ id: newId(), workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 0 });
    await db.insert(notification).values({
      id: newId(), userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'reminder', taskId,
      dedupeKey: 'rem:x', data: { title: 'T', projectName: 'P', dueDate: '2026-10-10', offsetDays: 0 },
    });

    await db.delete(task).where(eq(task.id, taskId));

    expect(await db.select().from(reminder)).toEqual([]);
    expect(await db.select().from(notification)).toEqual([]);
  });
});

describe('notification table', () => {
  it('refuses a second row with the same dedupe key', async () => {
    const { ctx } = await setup();
    const row = {
      userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'digest' as const, dedupeKey: 'dig:same',
      data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [] },
    };
    await db.insert(notification).values({ id: newId(), ...row });
    await expect(db.insert(notification).values({ id: newId(), ...row })).rejects.toThrow();
  });
});
```

Run: `yarn vitest run tests/server/reminder-schema.test.ts` — expect PASS (schema already pushed in Step 7; if it fails, the push did not apply).

- [ ] **Step 9: Write failing tests for reminder preferences**

In `tests/server/user-settings.test.ts`, change the import to also pull `getReminderPrefs, updateReminderPrefs`, and fix the exact-row assertion in "replaces an earlier zone…" (the row now has two more columns):

```ts
    expect(rows).toEqual([{ userId: ada.id, timezone: 'Asia/Tokyo', reminderHour: 9, digestEnabled: true }]);
```

Append:

```ts
describe('reminder preferences', () => {
  it('defaults to 09:00 with the digest on when the user has no row', async () => {
    const ada = await createUser('ada-rp@example.com');
    expect(await getReminderPrefs({ userId: ada.id })).toEqual({ reminderHour: 9, digestEnabled: true });
  });

  it('stores hour and digest switch, and keeps an existing timezone', async () => {
    const ada = await createUser('ada-rp2@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    const result = await updateReminderPrefs({ userId: ada.id }, { reminderHour: 18, digestEnabled: false });

    expect(result.ok).toBe(true);
    expect(await getReminderPrefs({ userId: ada.id })).toEqual({ reminderHour: 18, digestEnabled: false });
    expect(await getUserTimezone({ userId: ada.id })).toBe('Europe/Berlin');
  });

  it.each([-1, 24, 9.5])('rejects hour %j and writes nothing', async (hour) => {
    const ada = await createUser(`ada-rp-bad-${String(hour).replace('.', '_')}@example.com`);

    const result = await updateReminderPrefs({ userId: ada.id }, { reminderHour: hour, digestEnabled: true });

    expect(result).toEqual({ ok: false, error: 'Pick an hour between 00:00 and 23:00.' });
    expect(await db.select().from(userSettings)).toEqual([]);
  });
});
```

Run: `yarn vitest run tests/server/user-settings.test.ts` — expect FAIL (functions not exported).

- [ ] **Step 10: Implement prefs service and action**

Append to `src/server/user-settings/service.ts` (add `import { DEFAULT_REMINDER_HOUR } from '@/lib/reminders';`):

```ts
export type ReminderPrefs = { reminderHour: number; digestEnabled: boolean };

const reminderPrefsSchema = z.object({
  reminderHour: z.number().int().min(0).max(23),
  digestEnabled: z.boolean(),
});

/** When reminders and the digest go out, in the user's local time. */
export async function getReminderPrefs(ctx: UserContext): Promise<ReminderPrefs> {
  const [row] = await db
    .select({ reminderHour: userSettings.reminderHour, digestEnabled: userSettings.digestEnabled })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row ?? { reminderHour: DEFAULT_REMINDER_HOUR, digestEnabled: true };
}

export async function updateReminderPrefs(
  ctx: UserContext,
  input: ReminderPrefs,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = reminderPrefsSchema.safeParse(input);
    if (!parsed.success) return err('Pick an hour between 00:00 and 23:00.');

    await db
      .insert(userSettings)
      .values({ userId: ctx.userId, ...parsed.data })
      .onConflictDoUpdate({ target: userSettings.userId, set: parsed.data });

    return ok(null);
  });
}
```

Append to `src/server/user-settings/actions.ts` (extend the import from `./service` with `updateReminderPrefs, type ReminderPrefs`):

```ts
export async function updateReminderPrefsAction(input: ReminderPrefs): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateReminderPrefs(await requireUser(), input);
    if (result.ok) revalidatePath('/settings/preferences');
    return result;
  });
}
```

- [ ] **Step 11: Run tests, expect PASS**

Run: `yarn vitest run tests/server/user-settings.test.ts tests/server/reminder-schema.test.ts tests/unit/reminders.test.ts tests/unit/dates.test.ts && yarn typecheck`

- [ ] **Step 12: Commit**

```bash
git add src/db/schema/reminder.ts src/db/schema/settings.ts src/db/schema/index.ts src/lib/reminders.ts src/lib/dates.ts src/server/user-settings tests/setup/db.ts tests/unit/reminders.test.ts tests/unit/dates.test.ts tests/server/user-settings.test.ts tests/server/reminder-schema.test.ts
git commit -m "feat(reminders): reminder and notification tables, reminder preferences"
```

---

### Task 2: Per-task personal reminders service

**Files:**
- Create: `src/server/reminders/service.ts`
- Create: `src/server/reminders/actions.ts`
- Test: `tests/server/reminders.test.ts` (create)

**Interfaces:**
- Consumes: `reminder` table, `isReminderOffset`, `REMINDER_OFFSETS`, `type ReminderOffset` (Task 1)
- Produces: `listMyReminders(ctx: WorkspaceContext, taskId: string): Promise<ReminderOffset[]>` (ascending)
- Produces: `setTaskReminders(ctx: WorkspaceContext, input: { taskId: string; offsets: number[] }): Promise<Result<ReminderOffset[]>>` (returns the saved, sorted set)
- Produces: `setTaskRemindersAction(workspaceSlug: string, input: { taskId: string; offsets: number[] }): Promise<Result<ReminderOffset[]>>`

- [ ] **Step 1: Write failing tests**

`tests/server/reminders.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { reminder } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { listMyReminders, setTaskReminders } from '@/server/reminders/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

function ctxFor(userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext {
  return { userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC' };
}

async function setup(slug = 'ws-rem') {
  const ada = await createUser(`${slug}-ada@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx = ctxFor(ada.id, ws);
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T', dueDate: '2026-10-10' });
  if (!made.ok) throw new Error();
  return { ctx, ws, taskId: made.data.id };
}

describe('setTaskReminders', () => {
  it('saves my offsets sorted and de-duplicated, and reads them back', async () => {
    const { ctx, taskId } = await setup();

    const result = await setTaskReminders(ctx, { taskId, offsets: [7, 1, 1] });

    expect(result).toEqual({ ok: true, data: [1, 7] });
    expect(await listMyReminders(ctx, taskId)).toEqual([1, 7]);
  });

  it('replaces my previous set', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0, 1] });

    await setTaskReminders(ctx, { taskId, offsets: [2] });

    expect(await listMyReminders(ctx, taskId)).toEqual([2]);
  });

  it('an empty list clears mine', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });

    await setTaskReminders(ctx, { taskId, offsets: [] });

    expect(await db.select().from(reminder)).toEqual([]);
  });

  it('leaves a teammate’s reminders on the same task alone', async () => {
    const { ctx, ws, taskId } = await setup();
    const bob = await createUser('bob-rem@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    const bobCtx = ctxFor(bob.id, ws, 'member');
    await setTaskReminders(bobCtx, { taskId, offsets: [1] });

    await setTaskReminders(ctx, { taskId, offsets: [0] });
    await setTaskReminders(ctx, { taskId, offsets: [] });

    expect(await listMyReminders(bobCtx, taskId)).toEqual([1]);
    expect(await listMyReminders(ctx, taskId)).toEqual([]);
  });

  it('takes the user from the context, never from input', async () => {
    const { ctx, taskId } = await setup();

    await setTaskReminders(ctx, { taskId, offsets: [1], userId: 'someone-else' } as never);

    const [row] = await db.select().from(reminder);
    expect(row.userId).toBe(ctx.userId);
    expect(row.workspaceId).toBe(ctx.workspaceId);
  });

  it('rejects an offset that is not offered', async () => {
    const { ctx, taskId } = await setup();
    const result = await setTaskReminders(ctx, { taskId, offsets: [3] });
    expect(result).toEqual({ ok: false, error: 'Pick from the offered reminder times.' });
    expect(await db.select().from(reminder)).toEqual([]);
  });

  it('refuses a task from another workspace', async () => {
    const a = await setup('ws-rem-a');
    const b = await setup('ws-rem-b');

    const result = await setTaskReminders(a.ctx, { taskId: b.taskId, offsets: [1] });

    expect(result).toEqual({ ok: false, error: 'Task not found.' });
    expect(await listMyReminders(a.ctx, b.taskId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `yarn vitest run tests/server/reminders.test.ts`

- [ ] **Step 3: Implement `src/server/reminders/service.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, reminder, task } from '@/db';
import { newId } from '@/lib/ids';
import { isReminderOffset, type ReminderOffset } from '@/lib/reminders';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

/** My reminders on one task. Personal: a teammate's are never shown or touched. */
export async function listMyReminders(ctx: WorkspaceContext, taskId: string): Promise<ReminderOffset[]> {
  const rows = await db
    .select({ offsetDays: reminder.offsetDays })
    .from(reminder)
    .where(
      and(
        eq(reminder.taskId, taskId),
        eq(reminder.userId, ctx.userId),
        eq(reminder.workspaceId, ctx.workspaceId),
      ),
    )
    .orderBy(asc(reminder.offsetDays));
  return rows.map((r) => r.offsetDays as ReminderOffset);
}

const setSchema = z.object({
  taskId: z.string().min(1),
  offsets: z.array(z.number().refine(isReminderOffset)).max(4),
});

/** Replaces my set of reminders on a task in one transaction. */
export async function setTaskReminders(
  ctx: WorkspaceContext,
  input: { taskId: string; offsets: number[] },
): Promise<Result<ReminderOffset[]>> {
  return withAction(async () => {
    const parsed = setSchema.safeParse(input);
    if (!parsed.success) return err('Pick from the offered reminder times.');

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, parsed.data.taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const offsets = [...new Set(parsed.data.offsets as ReminderOffset[])].sort((a, b) => a - b);

    await db.transaction(async (tx) => {
      await tx
        .delete(reminder)
        .where(and(eq(reminder.taskId, owned.id), eq(reminder.userId, ctx.userId)));
      if (offsets.length) {
        await tx.insert(reminder).values(
          offsets.map((offsetDays) => ({
            id: newId(), workspaceId: ctx.workspaceId, taskId: owned.id, userId: ctx.userId, offsetDays,
          })),
        );
      }
    });

    return ok(offsets);
  });
}
```

- [ ] **Step 4: Implement `src/server/reminders/actions.ts`**

```ts
'use server';

import { withAction, type Result } from '@/lib/result';
import type { ReminderOffset } from '@/lib/reminders';
import { requireWorkspace } from '@/lib/session';
import { setTaskReminders } from './service';

/**
 * Slug-taking wrapper only: every export here is a public endpoint. No
 * revalidation — reminders are personal and only the task dialog shows them,
 * which keeps its own state.
 */
export async function setTaskRemindersAction(
  workspaceSlug: string,
  input: { taskId: string; offsets: number[] },
): Promise<Result<ReminderOffset[]>> {
  return withAction(async () => setTaskReminders(await requireWorkspace(workspaceSlug), input));
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `yarn vitest run tests/server/reminders.test.ts && yarn typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/server/reminders tests/server/reminders.test.ts
git commit -m "feat(reminders): personal per-task reminders service"
```

---

### Task 3: Select due reminders and digests, claim notifications

**Files:**
- Create: `src/server/reminders/select.ts`
- Test: `tests/server/reminder-select.test.ts` (create)

**Interfaces:**
- Consumes: `reminderKey`, `digestKey`, `DIGEST_TASK_CAP`, `DEFAULT_REMINDER_HOUR`, `ReminderData`, `DigestData`, `NotificationData` (Task 1); `DEFAULT_TIMEZONE` from `src/lib/dates.ts`; `setTaskReminders` (Task 2, tests only); `updateReminderPrefs`, `updateUserTimezone` (tests only)
- Produces:
  - `type NotificationDraft = { kind: 'reminder' | 'digest'; userId: string; workspaceId: string; taskId: string | null; dedupeKey: string; data: NotificationData }`
  - `selectDueReminders(now: Date): Promise<NotificationDraft[]>`
  - `selectDueDigests(now: Date): Promise<NotificationDraft[]>`
  - `claimNotifications(drafts: NotificationDraft[]): Promise<number>` (rows newly inserted)

Rules (from the spec): a reminder's moment is `((due_date - offset_days) + reminder_hour) AT TIME ZONE zone`; it is due when `now - 36h < moment ≤ now`. A digest's date is the recipient's local today if `today + hour` has passed, otherwise yesterday — so a late hour on the daily schedule still yields one digest per day. Both skip done tasks (status `is_done`), archived tasks, archived projects, ex-members, and zones Postgres does not know.

Fixed instants used below (October 2026: Asia/Yerevan = UTC+4, America/Los_Angeles = UTC−7):
- Yerevan 09:00 on 2026-10-09 = `2026-10-09T05:00:00Z`.
- Los Angeles 09:00 on 2026-10-10 = `2026-10-10T16:00:00Z`.

- [ ] **Step 1: Write failing tests**

`tests/server/reminder-select.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification, task, userSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { claimNotifications, selectDueDigests, selectDueReminders } from '@/server/reminders/select';
import { setTaskReminders } from '@/server/reminders/service';
import { createTask, updateTask } from '@/server/tasks/service';
import { updateReminderPrefs, updateUserTimezone } from '@/server/user-settings/service';

beforeEach(resetDb);
afterAll(closeDb);

const at = (iso: string) => new Date(iso);

/** Workspace in Asia/Yerevan (the factory default), one project, one task due 2026-10-10. */
async function setup(slug = 'ws-sel') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error();
  const detail = await getProject(ctx, project.data.id);
  const made = await createTask(ctx, { projectId: project.data.id, title: 'Ship', dueDate: '2026-10-10', assigneeId: ada.id });
  if (!made.ok) throw new Error();
  return { ctx, ws, projectId: project.data.id, statuses: detail!.statuses, taskId: made.data.id };
}

describe('selectDueReminders', () => {
  it('is due from the local hour on, for 36 hours', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [1] });

    expect(await selectDueReminders(at('2026-10-09T04:59:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-09T05:00:00Z'))).toEqual([{
      kind: 'reminder', userId: ctx.userId, workspaceId: ctx.workspaceId, taskId,
      dedupeKey: `rem:${taskId}:${ctx.userId}:2026-10-10:1`,
      data: { title: 'Ship', projectName: 'Website', dueDate: '2026-10-10', offsetDays: 1 },
    }]);
    expect(await selectDueReminders(at('2026-10-10T16:59:00Z'))).toHaveLength(1);
    expect(await selectDueReminders(at('2026-10-10T17:00:00Z'))).toEqual([]);
  });

  it('uses the user’s own zone and hour over the workspace’s', async () => {
    const { ctx, taskId } = await setup();
    await updateUserTimezone(ctx, 'America/Los_Angeles');
    await setTaskReminders(ctx, { taskId, offsets: [0] });

    expect(await selectDueReminders(at('2026-10-10T15:59:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-10T16:00:00Z'))).toHaveLength(1);

    await updateReminderPrefs(ctx, { reminderHour: 18, digestEnabled: true });
    expect(await selectDueReminders(at('2026-10-10T16:00:00Z'))).toEqual([]);
    expect(await selectDueReminders(at('2026-10-11T01:00:00Z'))).toHaveLength(1);
  });

  it('skips done, archived, undated, archived-project and ex-member tasks', async () => {
    const { ctx, ws, projectId, statuses, taskId } = await setup();
    const now = at('2026-10-10T06:00:00Z');
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    expect(await selectDueReminders(now)).toHaveLength(1);

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId, statusId: done.id });
    expect(await selectDueReminders(now)).toEqual([]);
    await updateTask(ctx, { taskId, statusId: statuses[0].id });

    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, taskId));
    expect(await selectDueReminders(now)).toEqual([]);
    await db.update(task).set({ archivedAt: null }).where(eq(task.id, taskId));

    await updateTask(ctx, { taskId, dueDate: null });
    expect(await selectDueReminders(now)).toEqual([]);
    await updateTask(ctx, { taskId, dueDate: '2026-10-10' });

    const bob = await createUser('bob-sel@example.com', 'Bob');
    const membership = await joinWorkspace(bob.id, ws.id, 'member');
    await setTaskReminders({ ...ctx, userId: bob.id, role: 'member' }, { taskId, offsets: [0] });
    expect(await selectDueReminders(now)).toHaveLength(2);
    await membership.remove();
    expect((await selectDueReminders(now)).map((d) => d.userId)).toEqual([ctx.userId]);

    await archiveProject(ctx, { projectId });
    expect(await selectDueReminders(now)).toEqual([]);
  });

  it('skips a zone Postgres does not know, without failing the others', async () => {
    const a = await setup('ws-sel-a');
    const b = await setup('ws-sel-b');
    await setTaskReminders(a.ctx, { taskId: a.taskId, offsets: [0] });
    await setTaskReminders(b.ctx, { taskId: b.taskId, offsets: [0] });
    // Written directly: the service would refuse it.
    await db.insert(userSettings).values({ userId: a.ctx.userId, timezone: 'Mars/Olympus' });

    const due = await selectDueReminders(at('2026-10-10T06:00:00Z'));

    expect(due.map((d) => d.userId)).toEqual([b.ctx.userId]);
  });

  it('a moved due date makes a new key; moving it back gives the old one', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    const [first] = await selectDueReminders(at('2026-10-10T06:00:00Z'));

    await updateTask(ctx, { taskId, dueDate: '2026-10-11' });
    const [moved] = await selectDueReminders(at('2026-10-11T06:00:00Z'));
    expect(moved.dedupeKey).not.toBe(first.dedupeKey);

    await updateTask(ctx, { taskId, dueDate: '2026-10-10' });
    const [back] = await selectDueReminders(at('2026-10-10T06:00:00Z'));
    expect(back.dedupeKey).toBe(first.dedupeKey);
  });
});

describe('selectDueDigests', () => {
  it('lists my tasks due today and overdue once the hour has passed', async () => {
    const { ctx, projectId } = await setup();
    const late = await createTask(ctx, { projectId, title: 'Late', dueDate: '2026-10-08', assigneeId: ctx.userId });
    await createTask(ctx, { projectId, title: 'Later', dueDate: '2026-10-12', assigneeId: ctx.userId });
    if (!late.ok) throw new Error();

    const [digest] = await selectDueDigests(at('2026-10-10T05:00:00Z'));

    expect(digest).toMatchObject({
      kind: 'digest', userId: ctx.userId, workspaceId: ctx.workspaceId, taskId: null,
      dedupeKey: `dig:${ctx.userId}:${ctx.workspaceId}:2026-10-10`,
      data: { localDate: '2026-10-10', dueToday: 1, overdue: 1 },
    });
    expect(digest.data).toMatchObject({ tasks: [{ title: 'Late', dueDate: '2026-10-08' }, { title: 'Ship', dueDate: '2026-10-10' }] });
  });

  it('before the hour, the digest is yesterday’s — so a late hour still sends once a day', async () => {
    const { ctx } = await setup();
    await updateReminderPrefs(ctx, { reminderHour: 23, digestEnabled: true });

    // 06:00 UTC = 10:00 Yerevan on the 11th; 23:00 has not come yet today.
    const [digest] = await selectDueDigests(at('2026-10-11T06:00:00Z'));

    expect(digest.dedupeKey).toBe(`dig:${ctx.userId}:${ctx.workspaceId}:2026-10-10`);
    // Counts are as of now: the task due on the 10th is overdue on the 11th.
    expect(digest.data).toMatchObject({ dueToday: 0, overdue: 1 });
  });

  it('sends nothing when the digest is off or nothing is due', async () => {
    const { ctx, taskId } = await setup();
    const now = at('2026-10-10T05:00:00Z');

    await updateReminderPrefs(ctx, { reminderHour: 9, digestEnabled: false });
    expect(await selectDueDigests(now)).toEqual([]);

    await updateReminderPrefs(ctx, { reminderHour: 9, digestEnabled: true });
    await updateTask(ctx, { taskId, dueDate: '2026-10-11' });
    expect(await selectDueDigests(now)).toEqual([]);
  });

  it('caps the listed tasks at 20 but counts all of them', async () => {
    const { ctx, projectId } = await setup();
    for (let i = 0; i < 24; i++) {
      await createTask(ctx, { projectId, title: `T${i}`, dueDate: '2026-10-10', assigneeId: ctx.userId });
    }

    const [digest] = await selectDueDigests(at('2026-10-10T05:00:00Z'));

    expect(digest.data).toMatchObject({ dueToday: 25, overdue: 0 });
    expect((digest.data as { tasks: unknown[] }).tasks).toHaveLength(20);
  });
});

describe('claimNotifications', () => {
  it('inserts each key once, however often it runs', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });
    const drafts = [
      ...(await selectDueReminders(at('2026-10-10T06:00:00Z'))),
      ...(await selectDueDigests(at('2026-10-10T06:00:00Z'))),
    ];

    expect(await claimNotifications(drafts)).toBe(2);
    expect(await claimNotifications(drafts)).toBe(0);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it('does nothing for an empty list', async () => {
    expect(await claimNotifications([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `yarn vitest run tests/server/reminder-select.test.ts`

- [ ] **Step 3: Implement `src/server/reminders/select.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db, notification } from '@/db';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { newId } from '@/lib/ids';
import {
  DEFAULT_REMINDER_HOUR, DIGEST_TASK_CAP, digestKey, reminderKey,
  type DigestData, type NotificationData, type ReminderOffset,
} from '@/lib/reminders';

export type NotificationDraft = {
  kind: 'reminder' | 'digest';
  userId: string;
  workspaceId: string;
  taskId: string | null;
  dedupeKey: string;
  data: NotificationData;
};

/*
 * System job queries: no ctx, they span every workspace (like sweepAttachments).
 * All zone arithmetic happens in Postgres. Zones are checked against
 * pg_timezone_names inside a MATERIALIZED CTE before any AT TIME ZONE runs, so
 * one bad stored zone skips its own rows instead of failing the whole query.
 */

export async function selectDueReminders(now: Date): Promise<NotificationDraft[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute<{
    user_id: string; workspace_id: string; task_id: string; title: string;
    project_name: string; due_date: string; offset_days: number;
  }>(sql`
    WITH zones AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    pending AS MATERIALIZED (
      SELECT r.user_id, t.workspace_id, t.id AS task_id, t.title, p.name AS project_name,
             t.due_date, r.offset_days::int AS offset_days,
             coalesce(us.reminder_hour, ${DEFAULT_REMINDER_HOUR})::int AS hour,
             coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) AS zone
      FROM reminder r
      JOIN task t ON t.id = r.task_id AND t.workspace_id = r.workspace_id
      JOIN task_status s ON s.id = t.status_id
      JOIN project p ON p.id = t.project_id
      JOIN member m ON m.organization_id = t.workspace_id AND m.user_id = r.user_id
      LEFT JOIN user_settings us ON us.user_id = r.user_id
      LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE t.due_date IS NOT NULL
        AND t.archived_at IS NULL
        AND NOT s.is_done
        AND p.archived_at IS NULL
        AND coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) IN (SELECT name FROM zones)
    )
    SELECT user_id, workspace_id, task_id, title, project_name, due_date::text AS due_date, offset_days
    FROM pending
    WHERE ((due_date - offset_days) + make_time(hour, 0, 0)) AT TIME ZONE zone <= ${at}
      AND ((due_date - offset_days) + make_time(hour, 0, 0)) AT TIME ZONE zone > ${at} - interval '36 hours'
    ORDER BY user_id, task_id, offset_days
  `);

  return result.rows.map((r) => ({
    kind: 'reminder',
    userId: r.user_id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    dedupeKey: reminderKey(r.task_id, r.user_id, r.due_date, r.offset_days),
    data: {
      title: r.title,
      projectName: r.project_name,
      dueDate: r.due_date,
      offsetDays: r.offset_days as ReminderOffset,
    },
  }));
}

export async function selectDueDigests(now: Date): Promise<NotificationDraft[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute<{
    user_id: string; workspace_id: string; today: string; digest_date: string;
    task_id: string; title: string; due_date: string;
  }>(sql`
    WITH zones AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    recipients AS MATERIALIZED (
      SELECT m.user_id, m.organization_id AS workspace_id,
             coalesce(us.reminder_hour, ${DEFAULT_REMINDER_HOUR})::int AS hour,
             coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) AS zone
      FROM member m
      LEFT JOIN user_settings us ON us.user_id = m.user_id
      LEFT JOIN workspace_settings ws ON ws.workspace_id = m.organization_id
      WHERE coalesce(us.digest_enabled, true)
        AND coalesce(us.timezone, ws.timezone, ${DEFAULT_TIMEZONE}) IN (SELECT name FROM zones)
    ),
    dated AS MATERIALIZED (
      SELECT r.*, (${at} AT TIME ZONE r.zone)::date AS today FROM recipients r
    ),
    due AS (
      SELECT d.*,
             CASE WHEN (d.today + make_time(d.hour, 0, 0)) AT TIME ZONE d.zone <= ${at}
                  THEN d.today ELSE d.today - 1 END AS digest_date
      FROM dated d
    )
    SELECT due.user_id, due.workspace_id, due.today::text AS today, due.digest_date::text AS digest_date,
           t.id AS task_id, t.title, t.due_date::text AS due_date
    FROM due
    JOIN task t ON t.workspace_id = due.workspace_id AND t.assignee_id = due.user_id
    JOIN task_status s ON s.id = t.status_id
    JOIN project p ON p.id = t.project_id
    WHERE t.due_date <= due.today
      AND t.archived_at IS NULL
      AND NOT s.is_done
      AND p.archived_at IS NULL
    ORDER BY due.user_id, due.workspace_id, t.due_date, t.id
  `);

  const groups = new Map<string, NotificationDraft & { data: DigestData }>();
  for (const r of result.rows) {
    const key = digestKey(r.user_id, r.workspace_id, r.digest_date);
    let draft = groups.get(key);
    if (!draft) {
      draft = {
        kind: 'digest', userId: r.user_id, workspaceId: r.workspace_id, taskId: null, dedupeKey: key,
        data: { localDate: r.digest_date, dueToday: 0, overdue: 0, tasks: [] },
      };
      groups.set(key, draft);
    }
    if (r.due_date === r.today) draft.data.dueToday += 1;
    else draft.data.overdue += 1;
    if (draft.data.tasks.length < DIGEST_TASK_CAP) {
      draft.data.tasks.push({ id: r.task_id, title: r.title, dueDate: r.due_date });
    }
  }
  return [...groups.values()];
}

/** Inserts drafts whose key is new; returns how many were. A repeat run inserts nothing. */
export async function claimNotifications(drafts: NotificationDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const rows = await db
    .insert(notification)
    .values(drafts.map((d) => ({ id: newId(), ...d })))
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });
  return rows.length;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `yarn vitest run tests/server/reminder-select.test.ts && yarn typecheck`

If the "skips a zone" test throws `time zone "Mars/Olympus" not recognized`, a CTE was inlined: check both zone-filtering CTEs say `AS MATERIALIZED`.

- [ ] **Step 5: Commit**

```bash
git add src/server/reminders/select.ts tests/server/reminder-select.test.ts
git commit -m "feat(reminders): select due reminders and digests, idempotent claim"
```

---

### Task 4: Email step, templates, `runReminders`, and the cron route

**Files:**
- Create: `src/lib/reminder-email.tsx` (React Email templates)
- Create: `src/lib/cron.ts`
- Create: `src/server/reminders/run.ts`
- Create: `src/app/api/cron/reminders/route.ts`
- Modify: `src/lib/email.tsx` (add `sendNotificationEmail`)
- Modify: `src/lib/reminders.ts` (add `OutgoingMail`, `MailSender` types)
- Modify: `src/app/api/cron/sweep-attachments/route.ts` (use `cronAuthorized`)
- Modify: `vercel.json`
- Test: `tests/unit/reminder-email.test.ts`, `tests/unit/cron.test.ts`, `tests/unit/reminders-route.test.ts`, `tests/server/reminder-run.test.ts` (all create)

**Interfaces:**
- Consumes: `selectDueReminders`, `selectDueDigests`, `claimNotifications` (Task 3); `reminderSubject`, `digestSubject`, `dueInLabel` (Task 1); `appUrl()` from `src/lib/url.ts`
- Produces (`src/lib/reminders.ts`):
  - `type OutgoingMail = { notificationId: string; to: string; slug: string; workspaceName: string } & ({ kind: 'reminder'; taskId: string; data: ReminderData } | { kind: 'digest'; taskId: null; data: DigestData })`
  - `type MailSender = (mail: OutgoingMail) => Promise<void>`
- Produces: `ReminderEmail({ data, url })`, `DigestEmail({ data, workspaceName, url })` (React components)
- Produces: `sendNotificationEmail: MailSender` in `src/lib/email.tsx`
- Produces: `cronAuthorized(request: Request): boolean`
- Produces: `claimUnsentEmails(limit?: number): Promise<OutgoingMail[]>`, `runReminders(opts?: { now?: Date; send?: MailSender }): Promise<{ claimed: number; emailed: number; failed: number }>`

- [ ] **Step 1: Add the mail types to `src/lib/reminders.ts`**

Append:

```ts
/** One claimed notification, ready to email. */
export type OutgoingMail = { notificationId: string; to: string; slug: string; workspaceName: string } & (
  | { kind: 'reminder'; taskId: string; data: ReminderData }
  | { kind: 'digest'; taskId: null; data: DigestData }
);

export type MailSender = (mail: OutgoingMail) => Promise<void>;
```

- [ ] **Step 2: Write failing template tests**

`tests/unit/reminder-email.test.ts`:

```ts
import { createElement } from 'react';
import { render } from 'react-email';
import { describe, expect, it } from 'vitest';
import { DigestEmail, ReminderEmail } from '@/lib/reminder-email';

describe('ReminderEmail', () => {
  it('names the task, project and when it is due, with a link', async () => {
    const text = await render(
      createElement(ReminderEmail, {
        data: { title: 'Ship v2', projectName: 'Website', dueDate: '2026-10-10', offsetDays: 1 },
        url: 'https://app.test/acme/tasks/t1',
      }),
      { plainText: true },
    );
    expect(text).toContain('Ship v2');
    expect(text).toContain('Website');
    expect(text).toContain('due tomorrow');
    expect(text).toContain('https://app.test/acme/tasks/t1');
  });
});

describe('DigestEmail', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, dueDate: '2026-10-10' }));

  it('lists the tasks and says how many more there are', async () => {
    const text = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 23, overdue: 2, tasks },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
      { plainText: true },
    );
    expect(text).toContain('23 due today · 2 overdue');
    expect(text).toContain('Task 19');
    expect(text).toContain('and 5 more');
    expect(text).toContain('https://app.test/acme/calendar');
  });

  it('has no "more" line when every task is listed', async () => {
    const text = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: tasks.slice(0, 1) },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
      { plainText: true },
    );
    expect(text).not.toContain('more');
  });

  it('renders a task title with markup as text', async () => {
    const html = await render(
      createElement(DigestEmail, {
        data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [{ id: 'x', title: '<b>bold</b>', dueDate: '2026-10-10' }] },
        workspaceName: 'Acme',
        url: 'https://app.test/acme/calendar',
      }),
    );
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
```

Run: `yarn vitest run tests/unit/reminder-email.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/reminder-email.tsx`**

```tsx
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'react-email';
import { formatDueDate } from '@/lib/dates';
import { digestSummary, dueInLabel, type DigestData, type ReminderData } from '@/lib/reminders';

// Align light tokens as hex (email clients do not understand oklch or CSS
// variables); same values as the auth emails in email.tsx.
const c = {
  background: '#F7F7F7', card: '#FFFFFF', border: '#EBEBEB', foreground: '#262626',
  muted: '#5C5C5C', primary: '#335CFF', primaryForeground: '#FFFFFF',
};

const body = { backgroundColor: c.background, fontFamily: 'Inter, Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' };
const card = { backgroundColor: c.card, border: `1px solid ${c.border}`, borderRadius: 16, margin: '0 auto', maxWidth: 480, padding: 24 };
const heading = { color: c.foreground, fontSize: 18, fontWeight: 600, margin: '0 0 8px' };
const text = { color: c.muted, fontSize: 14, lineHeight: '20px', margin: '0 0 8px' };
const button = {
  backgroundColor: c.primary, borderRadius: 10, color: c.primaryForeground, display: 'inline-block',
  fontSize: 14, fontWeight: 500, padding: '10px 16px', textDecoration: 'none',
};

// Dates in the email are relative to the due date itself; 'UTC' keeps the
// bare YYYY-MM-DD from shifting while it is formatted.
const dateLabel = (day: string) => formatDueDate(day, 'UTC', new Date(Date.UTC(1970, 0, 1)));

export function ReminderEmail({ data, url }: { data: ReminderData; url: string }) {
  return (
    <Html>
      <Head />
      <Preview>{`${data.title} is due ${dueInLabel(data.offsetDays)}`}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Heading style={heading}>{data.title}</Heading>
          <Text style={text}>
            {data.projectName} · due {dueInLabel(data.offsetDays)} ({dateLabel(data.dueDate)})
          </Text>
          <Section style={{ marginTop: 16 }}>
            <Button href={url} style={button}>Open task</Button>
          </Section>
          <Hr style={{ borderColor: c.border, margin: '24px 0 12px' }} />
          <Text style={{ ...text, fontSize: 12 }}>You set this reminder in Taskeeper.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function DigestEmail({ data, workspaceName, url }: { data: DigestData; workspaceName: string; url: string }) {
  const more = data.dueToday + data.overdue - data.tasks.length;
  return (
    <Html>
      <Head />
      <Preview>{`${digestSummary(data)} in ${workspaceName}`}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Heading style={heading}>{digestSummary(data)}</Heading>
          <Text style={text}>Your tasks in {workspaceName}.</Text>
          <Section style={{ margin: '12px 0' }}>
            {data.tasks.map((t) => (
              <Text key={t.id} style={{ ...text, color: c.foreground }}>
                {t.title} <span style={{ color: c.muted }}>· {dateLabel(t.dueDate)}</span>
              </Text>
            ))}
            {more > 0 && <Text style={text}>and {more} more</Text>}
          </Section>
          <Button href={url} style={button}>View my calendar</Button>
          <Hr style={{ borderColor: c.border, margin: '24px 0 12px' }} />
          <Text style={{ ...text, fontSize: 12 }}>Turn the daily digest off in Account → Preferences.</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

(`formatDueDate` with a `now` in 1970 never hits Today/Tomorrow/Yesterday and, being a different year, returns e.g. "10 Oct 2026".)

Run: `yarn vitest run tests/unit/reminder-email.test.ts` — expect PASS.

- [ ] **Step 4: Add `sendNotificationEmail` to `src/lib/email.tsx`**

Add imports `import { DigestEmail, ReminderEmail } from '@/lib/reminder-email';` and `import { digestSubject, reminderSubject, type MailSender } from '@/lib/reminders';`, then add above `sendCode`:

```tsx
/** Reminder and digest emails from the reminders cron (src/server/reminders/run.ts). */
export const sendNotificationEmail: MailSender = async (mail) => {
  if (mail.kind === 'reminder') {
    const url = `${appUrl()}/${mail.slug}/tasks/${mail.taskId}`;
    await send('reminder', mail.to, url, {
      subject: reminderSubject(mail.data),
      email: <ReminderEmail data={mail.data} url={url} />,
    });
    return;
  }
  const url = `${appUrl()}/${mail.slug}/calendar`;
  await send('digest', mail.to, url, {
    subject: digestSubject(mail.data, mail.workspaceName),
    email: <DigestEmail data={mail.data} workspaceName={mail.workspaceName} url={url} />,
  });
};
```

- [ ] **Step 5: Write failing test for `cronAuthorized`, then extract it**

`tests/unit/cron.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { cronAuthorized } from '@/lib/cron';

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/x', auth ? { headers: { authorization: auth } } : {});

afterEach(() => { delete process.env.CRON_SECRET; });

describe('cronAuthorized', () => {
  it('accepts the configured bearer secret', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(cronAuthorized(req('Bearer s3cret'))).toBe(true);
  });

  it('rejects a wrong or missing header', () => {
    process.env.CRON_SECRET = 's3cret';
    expect(cronAuthorized(req('Bearer nope'))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });

  it('rejects everyone when no secret is configured', () => {
    expect(cronAuthorized(req('Bearer '))).toBe(false);
    expect(cronAuthorized(req('Bearer undefined'))).toBe(false);
  });
});
```

Run: `yarn vitest run tests/unit/cron.test.ts` — expect FAIL.

`src/lib/cron.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

/** Vercel Cron's bearer check, shared by every route under /api/cron. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no cron: never run a job for an anonymous caller.
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

In `src/app/api/cron/sweep-attachments/route.ts`: delete the local `authorized` function and the `timingSafeEqual` import, add `import { cronAuthorized } from '@/lib/cron';`, and change the check to `if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });`.

Run: `yarn vitest run tests/unit/cron.test.ts` — expect PASS.

- [ ] **Step 6: Write failing tests for `runReminders`**

`tests/server/reminder-run.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { notification } from '@/db';
import type { OutgoingMail } from '@/lib/reminders';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { claimUnsentEmails, runReminders } from '@/server/reminders/run';
import { setTaskReminders } from '@/server/reminders/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const NOW = new Date('2026-10-10T06:00:00Z');

async function setup() {
  const ada = await createUser('run@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-run');
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug: 'ws-run', role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'Ship', dueDate: '2026-10-10', assigneeId: ada.id });
  if (!made.ok) throw new Error();
  await setTaskReminders(ctx, { taskId: made.data.id, offsets: [0] });
  return { ctx, taskId: made.data.id };
}

function recorder(failFor: (m: OutgoingMail) => boolean = () => false) {
  const sent: OutgoingMail[] = [];
  const send = async (m: OutgoingMail) => {
    if (failFor(m)) throw new Error('resend down');
    sent.push(m);
  };
  return { sent, send };
}

describe('runReminders', () => {
  it('claims and emails a reminder and a digest, with address and slug', async () => {
    const { taskId } = await setup();
    const { sent, send } = recorder();

    const result = await runReminders({ now: NOW, send });

    expect(result).toEqual({ claimed: 2, emailed: 2, failed: 0 });
    expect(sent.map((m) => m.kind).sort()).toEqual(['digest', 'reminder']);
    const rem = sent.find((m) => m.kind === 'reminder')!;
    expect(rem).toMatchObject({ to: 'run@example.com', slug: 'ws-run', workspaceName: 'Acme', taskId });
  });

  it('running twice sends nothing the second time', async () => {
    await setup();
    const { sent, send } = recorder();

    await runReminders({ now: NOW, send });
    const second = await runReminders({ now: NOW, send });

    expect(second).toEqual({ claimed: 0, emailed: 0, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(await db.select().from(notification)).toHaveLength(2);
  });

  it('a failed send does not stop the rest, and is retried later', async () => {
    await setup();
    const failing = recorder((m) => m.kind === 'reminder');

    const first = await runReminders({ now: NOW, send: failing.send });
    expect(first).toEqual({ claimed: 2, emailed: 1, failed: 1 });

    // Still inside the 10-minute lock: not picked up again.
    const ok = recorder();
    expect(await runReminders({ now: NOW, send: ok.send })).toEqual({ claimed: 0, emailed: 0, failed: 0 });

    await db.execute(sql`update notification set email_claimed_at = now() - interval '11 minutes'`);
    expect(await runReminders({ now: NOW, send: ok.send })).toEqual({ claimed: 0, emailed: 1, failed: 0 });
    expect(ok.sent.map((m) => m.kind)).toEqual(['reminder']);
  });

  it('gives up after 3 attempts', async () => {
    await setup();
    const failing = recorder(() => true);

    for (let i = 0; i < 3; i++) {
      await runReminders({ now: NOW, send: failing.send });
      await db.execute(sql`update notification set email_claimed_at = now() - interval '11 minutes'`);
    }
    const ok = recorder();
    await runReminders({ now: NOW, send: ok.send });

    expect(ok.sent).toEqual([]);
    const rows = await db.select({ attempts: notification.emailAttempts }).from(notification);
    expect(rows.map((r) => r.attempts)).toEqual([3, 3]);
  });

  it('two overlapping claims never take the same row', async () => {
    await setup();
    await runReminders({ now: NOW, send: async () => { throw new Error('x'); } });
    await db.execute(sql`update notification set email_claimed_at = null`);

    const [a, b] = await Promise.all([claimUnsentEmails(), claimUnsentEmails()]);

    const ids = [...a, ...b].map((m) => m.notificationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
  });
});
```

Run: `yarn vitest run tests/server/reminder-run.test.ts` — expect FAIL (module not found).

- [ ] **Step 7: Implement `src/server/reminders/run.ts`**

```ts
import { eq, inArray, sql } from 'drizzle-orm';
import { db, notification, organization, user } from '@/db';
import { sendNotificationEmail } from '@/lib/email';
import type { MailSender, OutgoingMail } from '@/lib/reminders';
import { claimNotifications, selectDueDigests, selectDueReminders } from './select';

const EMAIL_BATCH = 500;

/**
 * Locks up to `limit` unsent notifications for this run. SKIP LOCKED plus the
 * 10-minute claim means two overlapping runs never email the same row. Times
 * here are the database clock, not the job's `now`: they measure real elapsed
 * time since the row was created or claimed.
 */
export async function claimUnsentEmails(limit = EMAIL_BATCH): Promise<OutgoingMail[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE notification
    SET email_claimed_at = now(), email_attempts = email_attempts + 1
    WHERE id IN (
      SELECT id FROM notification
      WHERE email_sent_at IS NULL
        AND email_attempts < 3
        AND created_at > now() - interval '36 hours'
        AND (email_claimed_at IS NULL OR email_claimed_at < now() - interval '10 minutes')
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const ids = claimed.rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: notification.id, kind: notification.kind, taskId: notification.taskId, data: notification.data,
      to: user.email, slug: organization.slug, workspaceName: organization.name,
    })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .innerJoin(organization, eq(organization.id, notification.workspaceId))
    .where(inArray(notification.id, ids));

  return rows.map((r) => ({
    notificationId: r.id, to: r.to, slug: r.slug, workspaceName: r.workspaceName,
    kind: r.kind, taskId: r.taskId, data: r.data,
  }) as OutgoingMail);
}

/**
 * The reminders cron: select what is due, claim it (the bell sees it at once),
 * then email whatever is unsent. Claiming and emailing are separate so a Resend
 * outage delays email without losing or duplicating it.
 */
export async function runReminders({
  now = new Date(),
  send = sendNotificationEmail,
}: { now?: Date; send?: MailSender } = {}): Promise<{ claimed: number; emailed: number; failed: number }> {
  const drafts = [...(await selectDueReminders(now)), ...(await selectDueDigests(now))];
  const claimed = await claimNotifications(drafts);

  let emailed = 0;
  let failed = 0;
  for (const mail of await claimUnsentEmails()) {
    try {
      await send(mail);
      await db.update(notification).set({ emailSentAt: new Date() }).where(eq(notification.id, mail.notificationId));
      emailed += 1;
    } catch (error) {
      console.error('[reminders] email failed', mail.notificationId, error);
      failed += 1;
    }
  }

  return { claimed, emailed, failed };
}
```

Run: `yarn vitest run tests/server/reminder-run.test.ts` — expect PASS.

- [ ] **Step 8: Write the route and its test**

`tests/unit/reminders-route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/reminders/run', () => ({
  runReminders: vi.fn(async () => ({ claimed: 1, emailed: 1, failed: 0 })),
}));

const { GET } = await import('@/app/api/cron/reminders/route');
const { runReminders } = await import('@/server/reminders/run');

afterEach(() => { delete process.env.CRON_SECRET; vi.mocked(runReminders).mockClear(); });

const call = (auth?: string) =>
  GET(new Request('http://localhost/api/cron/reminders', auth ? { headers: { authorization: auth } } : {}) as never);

describe('GET /api/cron/reminders', () => {
  it('401s without the secret and runs nothing', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call();
    expect(res.status).toBe(401);
    expect(runReminders).not.toHaveBeenCalled();
  });

  it('runs the job and returns its counts', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, emailed: 1, failed: 0 });
  });
});
```

`src/app/api/cron/reminders/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { runReminders } from '@/server/reminders/run';

// Up to 500 emails a run, one Resend call each.
export const maxDuration = 300;

/**
 * Reminders and daily digests, scheduled in vercel.json. Daily on Vercel Hobby;
 * the same code runs hourly on Pro (see REMINDER_CRON_HOURLY).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runReminders());
}
```

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/sweep-attachments", "schedule": "0 4 * * *" },
    { "path": "/api/cron/reminders", "schedule": "0 6 * * *" }
  ]
}
```

Run: `yarn vitest run tests/unit/reminders-route.test.ts tests/unit/cron.test.ts && yarn typecheck`
Expected: PASS. (The route test runs with no database: `runReminders` is mocked.)

- [ ] **Step 9: Run the whole suite, then commit**

Run: `yarn test` — expect all green (the sweep route still passes its own tests).

```bash
git add src/lib/reminder-email.tsx src/lib/cron.ts src/lib/email.tsx src/lib/reminders.ts src/server/reminders/run.ts src/app/api/cron vercel.json tests/unit/reminder-email.test.ts tests/unit/cron.test.ts tests/unit/reminders-route.test.ts tests/server/reminder-run.test.ts
git commit -m "feat(reminders): email step, templates and daily reminders cron"
```

---

### Task 5: Notifications queries and the header bell

**Files:**
- Create: `src/server/notifications/queries.ts`
- Create: `src/server/notifications/service.ts`
- Create: `src/server/notifications/actions.ts`
- Create: `src/components/shell/NotificationBell.tsx`
- Modify: `src/lib/reminders.ts` (add `notificationText`, `notificationHref`)
- Modify: `src/components/shell/WorkspaceShell.tsx` (load unread count)
- Modify: `src/components/shell/AppHeader.tsx` (render the bell)
- Test: `tests/server/notifications.test.ts` (create), `tests/unit/reminders.test.ts` (extend)

**Interfaces:**
- Consumes: `notification` table, `NotificationData`, `dueInLabel`, `digestSummary` (Task 1)
- Produces:
  - `type NotificationItem = { id: string; kind: 'reminder' | 'digest'; taskId: string | null; data: NotificationData; readAt: Date | null; createdAt: Date }`
  - `listNotifications(ctx: WorkspaceContext, limit = 30): Promise<NotificationItem[]>` (newest first)
  - `unreadCount(ctx: WorkspaceContext): Promise<number>`
  - `markRead(ctx: WorkspaceContext, id: string): Promise<Result<null>>`, `markAllRead(ctx: WorkspaceContext): Promise<Result<null>>`
  - Actions: `listNotificationsAction(slug)`, `unreadCountAction(slug)`, `markNotificationReadAction(slug, id)`, `markAllNotificationsReadAction(slug)` — each `Promise<Result<…>>`
  - `notificationText(item: Pick<NotificationItem, 'kind' | 'data'>): { title: string; detail: string }`
  - `notificationHref(slug: string, item: Pick<NotificationItem, 'kind' | 'taskId'>): string`
  - `NotificationBell({ workspaceSlug, initialUnread }: { workspaceSlug: string; initialUnread: number })`

- [ ] **Step 1: Write failing unit tests for the bell copy**

Append to `tests/unit/reminders.test.ts` (extend the import with `notificationHref, notificationText`):

```ts
describe('bell item text and link', () => {
  it('describes a reminder by its task', () => {
    const item = { kind: 'reminder' as const, taskId: 't1', data: { title: 'Ship', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 0 as const } };
    expect(notificationText(item)).toEqual({ title: 'Ship', detail: 'Due today · Web' });
    expect(notificationHref('acme', item)).toBe('/acme/tasks/t1');
  });

  it('describes a digest by its counts and links to my calendar', () => {
    const item = { kind: 'digest' as const, taskId: null, data: { localDate: '2026-10-10', dueToday: 2, overdue: 1, tasks: [] } };
    expect(notificationText(item)).toEqual({ title: 'Daily digest', detail: '2 due today · 1 overdue' });
    expect(notificationHref('acme', item)).toBe('/acme/calendar');
  });
});
```

Run: `yarn vitest run tests/unit/reminders.test.ts` — expect FAIL.

- [ ] **Step 2: Implement in `src/lib/reminders.ts`**

Append:

```ts
type BellItem = { kind: 'reminder' | 'digest'; taskId: string | null; data: NotificationData };

export function notificationText(item: Pick<BellItem, 'kind' | 'data'>): { title: string; detail: string } {
  if (item.kind === 'reminder') {
    const d = item.data as ReminderData;
    const when = dueInLabel(d.offsetDays);
    return { title: d.title, detail: `Due ${when} · ${d.projectName}` };
  }
  return { title: 'Daily digest', detail: digestSummary(item.data as DigestData) };
}

export function notificationHref(slug: string, item: Pick<BellItem, 'kind' | 'taskId'>): string {
  return item.kind === 'reminder' && item.taskId ? `/${slug}/tasks/${item.taskId}` : `/${slug}/calendar`;
}
```

Run: `yarn vitest run tests/unit/reminders.test.ts` — expect PASS.

- [ ] **Step 3: Write failing server tests**

`tests/server/notifications.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { listNotifications, unreadCount } from '@/server/notifications/queries';
import { markAllRead, markRead } from '@/server/notifications/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
});

async function seed(userId: string, workspaceId: string, key: string, createdAt = new Date()) {
  const id = newId();
  await db.insert(notification).values({
    id, userId, workspaceId, kind: 'digest', dedupeKey: key, createdAt,
    data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [] },
  });
  return id;
}

async function setup() {
  const ada = await createUser('n-ada@example.com', 'Ada');
  const bob = await createUser('n-bob@example.com', 'Bob');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-n');
  const other = await createWorkspace(ada.id, 'Other', 'ws-n2');
  await joinWorkspace(bob.id, ws.id, 'member');
  return { ada: ctxFor(ada.id, ws), adaOther: ctxFor(ada.id, other), bob: ctxFor(bob.id, ws) };
}

describe('notifications', () => {
  it('lists only mine in this workspace, newest first, and counts unread', async () => {
    const { ada, adaOther, bob } = await setup();
    const older = await seed(ada.userId, ada.workspaceId, 'a1', new Date('2026-10-01T00:00:00Z'));
    const newer = await seed(ada.userId, ada.workspaceId, 'a2', new Date('2026-10-02T00:00:00Z'));
    await seed(ada.userId, adaOther.workspaceId, 'a3');
    await seed(bob.userId, bob.workspaceId, 'b1');

    expect((await listNotifications(ada)).map((n) => n.id)).toEqual([newer, older]);
    expect(await unreadCount(ada)).toBe(2);
  });

  it('marks one read, and cannot mark someone else’s', async () => {
    const { ada, bob } = await setup();
    const mine = await seed(ada.userId, ada.workspaceId, 'a1');
    const theirs = await seed(bob.userId, bob.workspaceId, 'b1');

    expect(await markRead(ada, mine)).toEqual({ ok: true, data: null });
    expect(await markRead(ada, theirs)).toEqual({ ok: false, error: 'Notification not found.' });

    expect(await unreadCount(ada)).toBe(0);
    expect(await unreadCount(bob)).toBe(1);
  });

  it('marks all of mine in this workspace read', async () => {
    const { ada, adaOther } = await setup();
    await seed(ada.userId, ada.workspaceId, 'a1');
    await seed(ada.userId, ada.workspaceId, 'a2');
    await seed(ada.userId, adaOther.workspaceId, 'a3');

    await markAllRead(ada);

    expect(await unreadCount(ada)).toBe(0);
    expect(await unreadCount(adaOther)).toBe(1);
  });

  it('caps the list at 30', async () => {
    const { ada } = await setup();
    for (let i = 0; i < 32; i++) await seed(ada.userId, ada.workspaceId, `k${i}`);
    expect(await listNotifications(ada)).toHaveLength(30);
  });
});
```

Run: `yarn vitest run tests/server/notifications.test.ts` — expect FAIL.

- [ ] **Step 4: Implement queries, service, actions**

`src/server/notifications/queries.ts`:

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, notification } from '@/db';
import type { NotificationData } from '@/lib/reminders';
import type { WorkspaceContext } from '@/lib/session';

export type NotificationItem = {
  id: string;
  kind: 'reminder' | 'digest';
  taskId: string | null;
  data: NotificationData;
  readAt: Date | null;
  createdAt: Date;
};

const mine = (ctx: WorkspaceContext) =>
  and(eq(notification.userId, ctx.userId), eq(notification.workspaceId, ctx.workspaceId));

export async function listNotifications(ctx: WorkspaceContext, limit = 30): Promise<NotificationItem[]> {
  return db
    .select({
      id: notification.id, kind: notification.kind, taskId: notification.taskId, data: notification.data,
      readAt: notification.readAt, createdAt: notification.createdAt,
    })
    .from(notification)
    .where(mine(ctx))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit);
}

export async function unreadCount(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(mine(ctx), isNull(notification.readAt)));
  return row?.n ?? 0;
}
```

`src/server/notifications/service.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db, notification } from '@/db';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';

export async function markRead(ctx: WorkspaceContext, id: string): Promise<Result<null>> {
  return withAction(async () => {
    const rows = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.id, id),
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: notification.id });
    return rows.length ? ok(null) : err('Notification not found.');
  });
}

export async function markAllRead(ctx: WorkspaceContext): Promise<Result<null>> {
  return withAction(async () => {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, ctx.userId),
          eq(notification.workspaceId, ctx.workspaceId),
          isNull(notification.readAt),
        ),
      );
    return ok(null);
  });
}
```

`src/server/notifications/actions.ts`:

```ts
'use server';

import { ok, withAction, type Result } from '@/lib/result';
import { requireWorkspace } from '@/lib/session';
import { listNotifications, unreadCount, type NotificationItem } from './queries';
import { markAllRead, markRead } from './service';

/** Slug-taking wrappers only: every export here is a public endpoint. */

export async function listNotificationsAction(workspaceSlug: string): Promise<Result<NotificationItem[]>> {
  return withAction(async () => ok(await listNotifications(await requireWorkspace(workspaceSlug))));
}

export async function unreadCountAction(workspaceSlug: string): Promise<Result<number>> {
  return withAction(async () => ok(await unreadCount(await requireWorkspace(workspaceSlug))));
}

export async function markNotificationReadAction(workspaceSlug: string, id: string): Promise<Result<null>> {
  return withAction(async () => markRead(await requireWorkspace(workspaceSlug), id));
}

export async function markAllNotificationsReadAction(workspaceSlug: string): Promise<Result<null>> {
  return withAction(async () => markAllRead(await requireWorkspace(workspaceSlug)));
}
```

Run: `yarn vitest run tests/server/notifications.test.ts` — expect PASS.

- [ ] **Step 5: Build the bell**

`src/components/shell/NotificationBell.tsx`:

```tsx
'use client';

import { IconBell } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import { notificationHref, notificationText } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import {
  listNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, unreadCountAction,
} from '@/server/notifications/actions';
import type { NotificationItem } from '@/server/notifications/queries';
import { cn } from '@/utils/cn';

/**
 * Header bell. The count arrives server-rendered with the shell and is
 * re-fetched when the window regains focus; the list loads when opened.
 * No realtime (roadmap slice 8).
 */
export function NotificationBell({ workspaceSlug, initialUnread }: { workspaceSlug: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const onFocus = async () => {
      const result = await settle(unreadCountAction(workspaceSlug));
      if (result.ok) setUnread(result.data);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [workspaceSlug]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    const result = await settle(listNotificationsAction(workspaceSlug));
    if (result.ok) setItems(result.data);
    else toast.error(result.error);
  }

  function markOne(item: NotificationItem) {
    setOpen(false);
    if (item.readAt) return;
    setUnread((n) => Math.max(0, n - 1));
    void settle(markNotificationReadAction(workspaceSlug, item.id));
  }

  async function markAll() {
    const result = await settle(markAllNotificationsReadAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    setUnread(0);
    setItems((list) => list?.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })) ?? null);
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <CompactButton.Root variant="ghost" size="large" aria-label={label} className="relative">
          <CompactButton.Icon as={IconBell} />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-base px-1 text-[0.625rem] font-medium text-static-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </CompactButton.Root>
      </Popover.Trigger>
      <Popover.Content align="end" sideOffset={8} showArrow={false} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-stroke-soft-200 px-4 py-3">
          <span className="text-label-sm text-text-strong-950">Notifications</span>
          <button
            type="button"
            onClick={markAll}
            disabled={unread === 0}
            className="text-label-xs text-primary-base disabled:text-text-disabled-300"
          >
            Mark all read
          </button>
        </div>
        <ul className="max-h-96 overflow-y-auto p-1" aria-label="Notifications">
          {items === null && <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Loading…</li>}
          {items?.length === 0 && (
            <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Nothing yet.</li>
          )}
          {items?.map((item) => {
            const { title, detail } = notificationText(item);
            return (
              <li key={item.id}>
                <Link
                  href={notificationHref(workspaceSlug, item)}
                  onClick={() => markOne(item)}
                  className="flex items-start gap-2 rounded-lg p-2 hover:bg-bg-weak-50"
                >
                  <span
                    aria-hidden="true"
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-primary-base')}
                  />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-label-sm', item.readAt ? 'text-text-sub-600' : 'text-text-strong-950')}>
                      {title}
                    </span>
                    <span className="block truncate text-paragraph-xs text-text-sub-600">{detail}</span>
                  </span>
                  {!item.readAt && <span className="sr-only">Unread</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </Popover.Content>
    </Popover.Root>
  );
}
```

`CompactButton` `variant="ghost"` / `size="large"` and the `bg-error-base` / `text-static-white` tokens all exist.

- [ ] **Step 6: Wire it into the shell**

`src/components/shell/WorkspaceShell.tsx` — add `import { unreadCount } from '@/server/notifications/queries';`, fetch it with the others, and pass it to the header only:

```tsx
  const [projects, workspaces, unread] = await Promise.all([
    listProjects(ctx),
    listMyWorkspaces(ctx.userId),
    unreadCount(ctx),
  ]);
```

```tsx
        <AppHeader {...railProps} unread={unread} />
```

`src/components/shell/AppHeader.tsx` — import `NotificationBell`, change the signature to `export function AppHeader({ unread, ...props }: RailProps & { unread: number })`, and render the bell after the palette's wrapper `div`, before `<CreateTaskDialog`:

```tsx
      <NotificationBell workspaceSlug={props.workspaceSlug} initialUnread={unread} />
```

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/notifications src/components/shell/NotificationBell.tsx src/components/shell/WorkspaceShell.tsx src/components/shell/AppHeader.tsx src/lib/reminders.ts tests/server/notifications.test.ts tests/unit/reminders.test.ts
git commit -m "feat(notifications): header bell with unread count and mark read"
```

---

### Task 6: Month grid math, calendar query, and week start

**Files:**
- Create: `src/components/calendar/month-grid.ts`
- Create: `src/server/tasks/calendar.ts`
- Create: `src/server/settings/queries.ts`
- Test: `tests/unit/month-grid.test.ts` (create), `tests/server/calendar.test.ts` (create)

**Interfaces:**
- Consumes: `addDays`, `isCalendarDay`, `todayInZone` from `src/lib/dates.ts`
- Produces (`month-grid.ts`, pure):
  - `parseMonth(param: string | undefined, today: string): string` → `'YYYY-MM'` (bad/missing → today's month)
  - `shiftMonth(month: string, delta: number): string`
  - `monthWeeks(month: string, weekStart: number): string[][]` → always 6 rows × 7 `YYYY-MM-DD`
  - `monthLabel(month: string): string` → e.g. `"October 2026"`
  - `weekdayLabels(weekStart: number): string[]` → e.g. `['Mon', …, 'Sun']`
  - `dropTarget(fromDay: string | null, overId: string | null): string | null` → the new due date, or null when nothing should be saved
- Produces: `type CalendarTask = { id: string; title: string; dueDate: string; isDone: boolean; statusColor: string; statusIcon: string | null; assigneeName: string | null; assigneeImage: string | null; projectId: string; projectName: string; projectColor: string }`
- Produces: `listCalendarTasks(ctx: WorkspaceContext, range: { from: string; to: string } & ({ projectId: string } | { mine: true })): Promise<CalendarTask[]>` — throws `RangeError` when the range is invalid or longer than 42 days
- Produces: `getWeekStart(ctx: WorkspaceContext): Promise<number>` (0–6, default 1)

- [ ] **Step 1: Write failing grid tests**

`tests/unit/month-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dropTarget, monthLabel, monthWeeks, parseMonth, shiftMonth, weekdayLabels,
} from '@/components/calendar/month-grid';

describe('parseMonth', () => {
  it('takes a valid YYYY-MM', () => {
    expect(parseMonth('2026-02', '2026-10-03')).toBe('2026-02');
  });

  it.each([undefined, '', '2026-13', '2026-1', 'abc', '2026-10-01'])('falls back to today’s month for %j', (bad) => {
    expect(parseMonth(bad, '2026-10-03')).toBe('2026-10');
  });
});

describe('shiftMonth', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('monthWeeks', () => {
  it('is always 6 weeks of 7 days', () => {
    const weeks = monthWeeks('2026-02', 1);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('starts on Monday with weekStart 1 (Oct 2026 starts on a Thursday)', () => {
    const weeks = monthWeeks('2026-10', 1);
    expect(weeks[0]).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(weeks[5][6]).toBe('2026-11-08');
  });

  it('starts on Sunday with weekStart 0', () => {
    expect(monthWeeks('2026-10', 0)[0][0]).toBe('2026-09-27');
  });

  it('puts the 1st in the first row when the month starts on the week start', () => {
    // 2026-06-01 is a Monday.
    expect(monthWeeks('2026-06', 1)[0][0]).toBe('2026-06-01');
  });

  it('handles a leap February', () => {
    const days = monthWeeks('2028-02', 1).flat();
    expect(days).toContain('2028-02-29');
  });
});

describe('labels', () => {
  it('names the month', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
  });

  it('orders weekdays from the week start', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(0)[0]).toBe('Sun');
  });
});

describe('dropTarget', () => {
  it('returns the new day', () => {
    expect(dropTarget('2026-10-03', '2026-10-05')).toBe('2026-10-05');
  });

  it('is null for the same day, no target, or a non-day target', () => {
    expect(dropTarget('2026-10-03', '2026-10-03')).toBeNull();
    expect(dropTarget('2026-10-03', null)).toBeNull();
    expect(dropTarget('2026-10-03', 'task-abc')).toBeNull();
  });
});
```

Run: `yarn vitest run tests/unit/month-grid.test.ts` — expect FAIL.

- [ ] **Step 2: Implement `src/components/calendar/month-grid.ts`**

```ts
import { addDays, isCalendarDay } from '@/lib/dates';

/*
 * Calendar math on 'YYYY-MM' and 'YYYY-MM-DD' strings only. Due dates are
 * calendar days, not instants, so nothing here builds a local Date to compare.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(param: string | undefined, today: string): string {
  return param && MONTH.test(param) ? param : today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Day of week (0 = Sunday) of a calendar day; UTC so no zone can shift it. */
function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Six weeks covering the month, starting on the week-start day on or before the 1st. */
export function monthWeeks(month: string, weekStart: number): string[][] {
  const first = `${month}-01`;
  const lead = (weekday(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)));
}

export function weekdayLabels(weekStart: number): string[] {
  const format = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  // 2026-10-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2026, 9, 4 + ((weekStart + i) % 7)))),
  );
}

/** The day a drop should save, or null: same day, released outside, or not on a day cell. */
export function dropTarget(fromDay: string | null, overId: string | null): string | null {
  if (!overId || !isCalendarDay(overId) || overId === fromDay) return null;
  return overId;
}
```

Run: `yarn vitest run tests/unit/month-grid.test.ts` — expect PASS.

- [ ] **Step 3: Write failing server tests for the query and week start**

`tests/server/calendar.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { task, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const RANGE = { from: '2026-09-28', to: '2026-11-08' };

async function setup(slug = 'ws-cal') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const p1 = await createProject(ctx, { name: 'Web' });
  const p2 = await createProject(ctx, { name: 'App' });
  if (!p1.ok || !p2.ok) throw new Error();
  return { ctx, ws, p1: p1.data.id, p2: p2.data.id };
}

async function add(ctx: WorkspaceContext, projectId: string, title: string, dueDate: string | null, assigneeId?: string) {
  const made = await createTask(ctx, { projectId, title, dueDate, assigneeId });
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

describe('listCalendarTasks', () => {
  it('returns a project’s dated tasks inside the range, by date', async () => {
    const { ctx, p1, p2 } = await setup();
    await add(ctx, p1, 'B', '2026-10-05');
    await add(ctx, p1, 'A', '2026-10-01');
    await add(ctx, p1, 'Undated', null);
    await add(ctx, p1, 'Outside', '2026-12-01');
    await add(ctx, p2, 'Other project', '2026-10-02');

    const rows = await listCalendarTasks(ctx, { ...RANGE, projectId: p1 });

    expect(rows.map((r) => [r.title, r.dueDate])).toEqual([['A', '2026-10-01'], ['B', '2026-10-05']]);
    expect(rows[0]).toMatchObject({ projectId: p1, projectName: 'Web', isDone: false });
  });

  it('includes the range edges', async () => {
    const { ctx, p1 } = await setup();
    await add(ctx, p1, 'First', '2026-09-28');
    await add(ctx, p1, 'Last', '2026-11-08');
    expect(await listCalendarTasks(ctx, { ...RANGE, projectId: p1 })).toHaveLength(2);
  });

  it('“mine” spans projects but only my assigned tasks, and skips archived projects and tasks', async () => {
    const { ctx, ws, p1, p2 } = await setup();
    const bob = await createUser('bob-cal@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    await add(ctx, p1, 'Mine 1', '2026-10-01', ctx.userId);
    await add(ctx, p2, 'Mine 2', '2026-10-02', ctx.userId);
    await add(ctx, p1, 'Bob’s', '2026-10-03', bob.id);
    const archived = await add(ctx, p1, 'Archived', '2026-10-04', ctx.userId);
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, archived));

    expect((await listCalendarTasks(ctx, { ...RANGE, mine: true })).map((r) => r.title)).toEqual(['Mine 1', 'Mine 2']);

    await archiveProject(ctx, { projectId: p2 });
    expect((await listCalendarTasks(ctx, { ...RANGE, mine: true })).map((r) => r.title)).toEqual(['Mine 1']);
  });

  it('marks done tasks', async () => {
    const { ctx, p1 } = await setup();
    const statuses = (await getProject(ctx, p1))!.statuses;
    const done = statuses.find((s) => s.isDone)!;
    await createTask(ctx, { projectId: p1, title: 'Done', dueDate: '2026-10-01', statusId: done.id });

    const [row] = await listCalendarTasks(ctx, { ...RANGE, projectId: p1 });

    expect(row.isDone).toBe(true);
  });

  it('never returns another workspace’s project', async () => {
    const a = await setup('ws-cal-a');
    const b = await setup('ws-cal-b');
    await add(b.ctx, b.p1, 'Theirs', '2026-10-01');

    expect(await listCalendarTasks(a.ctx, { ...RANGE, projectId: b.p1 })).toEqual([]);
  });

  it.each([
    { from: '2026-10-01', to: '2026-11-20' },
    { from: '2026-10-10', to: '2026-10-01' },
    { from: 'bad', to: '2026-10-01' },
  ])('rejects range %j', async (range) => {
    const { ctx, p1 } = await setup();
    await expect(listCalendarTasks(ctx, { ...range, projectId: p1 })).rejects.toThrow(RangeError);
  });
});

describe('getWeekStart', () => {
  it('reads the workspace setting', async () => {
    const { ctx, ws } = await setup();
    expect(await getWeekStart(ctx)).toBe(1);
    await db.update(workspaceSettings).set({ weekStart: 0 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await getWeekStart(ctx)).toBe(0);
  });
});
```

Run: `yarn vitest run tests/server/calendar.test.ts` — expect FAIL.

- [ ] **Step 4: Implement the query and week start**

`src/server/tasks/calendar.ts`:

```ts
import { and, asc, eq, gte, isNull, isNotNull, lte } from 'drizzle-orm';
import { db, project, task, taskStatus, user } from '@/db';
import { addDays, isCalendarDay } from '@/lib/dates';
import { byKey } from '@/lib/position';
import type { WorkspaceContext } from '@/lib/session';

export type CalendarTask = {
  id: string;
  title: string;
  dueDate: string;
  isDone: boolean;
  statusColor: string;
  statusIcon: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  projectId: string;
  projectName: string;
  projectColor: string;
};

export type CalendarRange = { from: string; to: string } & ({ projectId: string } | { mine: true });

const MAX_DAYS = 42;

/**
 * Dated tasks in a visible calendar range, for one project or for "my calendar"
 * (assigned to me across active projects). Subtasks are included: they carry
 * their own due dates.
 */
export async function listCalendarTasks(ctx: WorkspaceContext, range: CalendarRange): Promise<CalendarTask[]> {
  const { from, to } = range;
  if (!isCalendarDay(from) || !isCalendarDay(to) || to < from || addDays(from, MAX_DAYS - 1) < to) {
    throw new RangeError(`Calendar range ${from}..${to} is invalid or longer than ${MAX_DAYS} days.`);
  }

  const scope = 'projectId' in range ? eq(task.projectId, range.projectId) : eq(task.assigneeId, ctx.userId);

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      isDone: taskStatus.isDone,
      statusColor: taskStatus.color,
      statusIcon: taskStatus.icon,
      assigneeName: user.name,
      assigneeImage: user.image,
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(taskStatus, eq(taskStatus.id, task.statusId))
    .leftJoin(user, eq(user.id, task.assigneeId))
    .where(
      and(
        eq(task.workspaceId, ctx.workspaceId),
        scope,
        isNotNull(task.dueDate),
        gte(task.dueDate, from),
        lte(task.dueDate, to),
        isNull(task.archivedAt),
        isNull(project.archivedAt),
      ),
    )
    .orderBy(asc(task.dueDate), byKey(task.position), asc(task.id));

  // due_date is non-null here (filtered above); the select type cannot know that.
  return rows as CalendarTask[];
}
```

`src/server/settings/queries.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

/** First day of the week for this workspace's calendars (0 = Sunday). */
export async function getWeekStart(ctx: WorkspaceContext): Promise<number> {
  const [row] = await db
    .select({ weekStart: workspaceSettings.weekStart })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, ctx.workspaceId))
    .limit(1);
  return row?.weekStart ?? 1;
}
```

Note the "archived project" case for a project calendar: `isNull(project.archivedAt)` also hides a project calendar's tasks once the project is archived — fine, since an archived project's pages 404 already.

Run: `yarn vitest run tests/server/calendar.test.ts tests/unit/month-grid.test.ts && yarn typecheck` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/month-grid.ts src/server/tasks/calendar.ts src/server/settings/queries.ts tests/unit/month-grid.test.ts tests/server/calendar.test.ts
git commit -m "feat(calendar): month grid math, calendar range query, week start"
```

---

### Task 7: Calendar month component, drag to reschedule, routes and navigation

**Files:**
- Create: `src/components/calendar/CalendarMonth.tsx`
- Create: `src/components/calendar/CalendarChip.tsx`
- Create: `src/app/(app)/[workspaceSlug]/projects/[projectId]/calendar/page.tsx`
- Create: `src/app/(app)/[workspaceSlug]/calendar/page.tsx`
- Modify: `src/components/shell/ViewTabs.tsx` (Calendar tab)
- Modify: `src/components/shell/Rail.tsx:100-104` (My calendar entry)
- Test: covered by Task 6 unit tests (`dropTarget`, grid) and Task 9 e2e; this task ends with typecheck, lint and a manual check

**Interfaces:**
- Consumes: `monthWeeks`, `monthLabel`, `weekdayLabels`, `shiftMonth`, `parseMonth`, `dropTarget`, `CalendarTask`, `listCalendarTasks`, `getWeekStart` (Task 6); `updateTaskAction(slug, { taskId, dueDate })`; `StatusIcon`, `AssigneeAvatar`, `ProjectTaskDialog`, `ProjectHeader`, `StarButton`, `ProjectMenu`; `settle`; `todayInZone`
- Produces: `CalendarMonth({ workspaceSlug, month, weekStart, today, tasks, taskHref, showProject }: { workspaceSlug: string; month: string; weekStart: number; today: string; tasks: CalendarTask[]; taskHref: 'modal' | 'page'; showProject: boolean })`
- Produces: `CalendarChip({ task, today, showProject, onOpen, dragging? })`

- [ ] **Step 1: Build `CalendarChip.tsx`**

```tsx
'use client';

import { useDraggable } from '@dnd-kit/core';
import { AssigneeAvatar } from '@/components/task/AssigneeAvatar';
import { StatusIcon } from '@/components/task/StatusIcon';
import type { CalendarTask } from '@/server/tasks/calendar';
import { cn } from '@/utils/cn';

/**
 * One task on the calendar: a button (Enter/click opens it) that dnd-kit can
 * lift (mouse drag past 8px, long press, or Space). Done tasks are struck
 * through; overdue ones are tinted.
 */
export function CalendarChip({
  task,
  today,
  showProject,
  onOpen,
}: {
  task: CalendarTask;
  today: string;
  showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { day: task.dueDate },
  });
  const overdue = !task.isDone && task.dueDate < today;

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      aria-label={`${task.title}${task.isDone ? ', done' : overdue ? ', overdue' : ''}`}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-paragraph-xs ring-1 ring-inset',
        'bg-bg-white-0 ring-stroke-soft-200 hover:bg-bg-weak-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
        overdue && 'bg-error-lighter ring-error-light',
        isDragging && 'relative z-20 shadow-regular-md',
      )}
    >
      {showProject ? (
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', `bg-${task.projectColor}-base`)} />
      ) : (
        <StatusIcon status={{ color: task.statusColor, isDone: task.isDone, icon: task.statusIcon }} className="size-3.5 shrink-0" />
      )}
      <span className={cn('min-w-0 flex-1 truncate', task.isDone ? 'text-text-soft-400 line-through' : 'text-text-strong-950')}>
        {task.title}
      </span>
      {task.assigneeName && (
        <AssigneeAvatar name={task.assigneeName} image={task.assigneeImage} className="size-4 text-[0.5rem]" />
      )}
    </button>
  );
}
```

Project color classes: check how `src/components/shell/ProjectColorPicker.tsx` turns `project.color` into a class (it may use a lookup map rather than `bg-${color}-base`, since Tailwind cannot see dynamic class names). Reuse that exact helper for the dot instead of the template string above.

- [ ] **Step 2: Build `CalendarMonth.tsx`**

```tsx
'use client';

import {
  type CollisionDetection, closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor,
  pointerWithin, TouchSensor, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarChip } from '@/components/calendar/CalendarChip';
import { dropTarget, monthLabel, monthWeeks, shiftMonth, weekdayLabels } from '@/components/calendar/month-grid';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import { formatDueDate } from '@/lib/dates';
import { settle } from '@/lib/settle';
import type { CalendarTask } from '@/server/tasks/calendar';
import { updateTaskAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

const VISIBLE_PER_DAY = 3;

type Move = { taskId: string; dueDate: string };

// With a pointer only what it is inside counts (released off the grid = no
// drop); the keyboard has no pointer, so the nearest day wins.
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

export function CalendarMonth({
  workspaceSlug,
  month,
  weekStart,
  today,
  tasks,
  taskHref,
  showProject,
}: {
  workspaceSlug: string;
  month: string;
  weekStart: number;
  today: string;
  tasks: CalendarTask[];
  /** 'modal' opens ?task= over this page (project view); 'page' goes to the task's own page. */
  taskHref: 'modal' | 'page';
  showProject: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState('');

  const [optimistic, applyMove] = useOptimistic(tasks, (current: CalendarTask[], move: Move) =>
    current.map((t) => (t.id === move.taskId ? { ...t, dueDate: move.dueDate } : t)),
  );

  const byDay = new Map<string, CalendarTask[]>();
  for (const t of optimistic) byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);

  const weeks = monthWeeks(month, weekStart);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // Space only, so Enter on a focused chip opens the task instead of lifting it.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Tab'] } }),
  );

  function open(task: CalendarTask) {
    if (taskHref === 'page') {
      router.push(`/${workspaceSlug}/tasks/${task.id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDragEnd(event: DragEndEvent) {
    const from = (event.active.data.current?.day as string | undefined) ?? null;
    const to = dropTarget(from, event.over ? String(event.over.id) : null);
    if (!to) return;

    const taskId = String(event.active.id);
    setAnnouncement(`Moved to ${formatDueDate(to, 'UTC', new Date(`${today}T12:00:00Z`))}.`);
    startTransition(async () => {
      applyMove({ taskId, dueDate: to });
      const result = await settle(updateTaskAction(workspaceSlug, { taskId, dueDate: to }));
      if (!result.ok) toast.error(result.error);
      // Either way: confirm on success, discard the optimistic move on failure.
      router.refresh();
    });
  }

  const monthHref = (m: string) => `?m=${m}`;
  const inMonth = (day: string) => day.startsWith(month);

  return (
    <section aria-label={`Calendar, ${monthLabel(month)}`} className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-8">
      <div className="flex items-center gap-2 py-3">
        <h2 className="text-label-lg text-text-strong-950">{monthLabel(month)}</h2>
        <div className="ml-auto flex items-center gap-1">
          <CompactButton.Root asChild variant="ghost" size="large">
            <Link href={monthHref(shiftMonth(month, -1))} aria-label="Previous month">
              <CompactButton.Icon as={IconChevronLeft} />
            </Link>
          </CompactButton.Root>
          <Button.Root asChild size="xsmall" variant="neutral" mode="stroke">
            <Link href={monthHref(today.slice(0, 7))}>Today</Link>
          </Button.Root>
          <CompactButton.Root asChild variant="ghost" size="large">
            <Link href={monthHref(shiftMonth(month, 1))} aria-label="Next month">
              <CompactButton.Icon as={IconChevronRight} />
            </Link>
          </CompactButton.Root>
        </div>
      </div>

      <DndContext id="calendar" sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
        {/* Grid from sm up. */}
        <div role="grid" aria-label={monthLabel(month)} className="hidden flex-1 flex-col overflow-hidden rounded-2xl ring-1 ring-inset ring-stroke-soft-200 sm:flex">
          <div role="row" className="grid grid-cols-7 border-b border-stroke-soft-200 bg-bg-weak-50">
            {weekdayLabels(weekStart).map((d) => (
              <div key={d} role="columnheader" className="px-2 py-1.5 text-label-xs text-text-sub-600">{d}</div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} role="row" className="grid flex-1 grid-cols-7 border-b border-stroke-soft-200 last:border-b-0">
              {week.map((day) => (
                <DayCell
                  key={day}
                  day={day}
                  today={today}
                  muted={!inMonth(day)}
                  tasks={byDay.get(day) ?? []}
                  showProject={showProject}
                  onOpen={open}
                />
              ))}
            </div>
          ))}
        </div>
      </DndContext>

      {/* Phone: the month's dated tasks as a list. */}
      <ol className="flex flex-col gap-4 sm:hidden">
        {weeks.flat().filter((d) => inMonth(d) && byDay.has(d)).map((day) => (
          <li key={day}>
            <h3 className={cn('mb-1 text-label-sm', day === today ? 'text-primary-base' : 'text-text-sub-600')}>
              {formatDueDate(day, 'UTC', new Date(`${today}T12:00:00Z`))}
            </h3>
            <ul className="flex flex-col gap-1">
              {byDay.get(day)!.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => open(t)} className="w-full truncate rounded-lg px-2 py-1.5 text-left text-paragraph-sm ring-1 ring-inset ring-stroke-soft-200">
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div aria-live="polite" className="sr-only">{announcement}</div>
    </section>
  );
}

function DayCell({
  day, today, muted, tasks, showProject, onOpen,
}: {
  day: string; today: string; muted: boolean; tasks: CalendarTask[]; showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const visible = tasks.slice(0, VISIBLE_PER_DAY);
  const hidden = tasks.length - visible.length;
  const label = Number(day.slice(8));

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={day}
      className={cn(
        'flex min-h-24 min-w-0 flex-col gap-1 border-r border-stroke-soft-200 p-1.5 last:border-r-0',
        muted && 'bg-bg-weak-50',
        isOver && 'bg-primary-alpha-10',
      )}
    >
      <span
        className={cn(
          'tabular flex size-6 items-center justify-center rounded-full text-label-xs',
          day === today ? 'bg-primary-base text-static-white' : muted ? 'text-text-soft-400' : 'text-text-sub-600',
        )}
        aria-current={day === today ? 'date' : undefined}
      >
        {label}
      </span>
      {visible.map((t) => (
        <CalendarChip key={t.id} task={t} today={today} showProject={showProject} onOpen={onOpen} />
      ))}
      {hidden > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="rounded-md px-1.5 text-left text-label-xs text-text-sub-600 hover:text-text-strong-950">
              +{hidden} more
            </button>
          </Popover.Trigger>
          <Popover.Content align="start" sideOffset={4} showArrow={false} className="flex w-64 flex-col gap-1 p-2">
            {/* Only the hidden ones: dnd-kit needs each draggable id once. */}
            {tasks.slice(VISIBLE_PER_DAY).map((t) => (
              <CalendarChip key={t.id} task={t} today={today} showProject={showProject} onOpen={onOpen} />
            ))}
          </Popover.Content>
        </Popover.Root>
      )}
    </div>
  );
}
```

`Button.Root size="xsmall"`, `CompactButton size="large"` and the tokens used here (`bg-primary-alpha-10`, `bg-error-lighter`, `ring-error-light`, `text-static-white`) all exist.

- [ ] **Step 3: Add the project Calendar route**

`src/app/(app)/[workspaceSlug]/projects/[projectId]/calendar/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { ProjectHeader } from '@/components/shell/ProjectHeader';
import { ProjectMenu } from '@/components/shell/ProjectMenu';
import { StarButton } from '@/components/shell/StarButton';
import { ProjectTaskDialog } from '@/components/task/ProjectTaskDialog';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { getProject } from '@/server/projects/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{ task?: string; m?: string }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const { task: openTaskId, m } = await searchParams;
  const today = todayInZone(ctx.timezone);
  const month = parseMonth(m, today);
  const weekStart = await getWeekStart(ctx);
  const days = monthWeeks(month, weekStart).flat();
  const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], projectId });
  const basePath = `/${workspaceSlug}/projects/${projectId}`;

  // Viewport minus the h-14 app header, so the grid fills the page.
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <ProjectHeader
        name={project.name}
        basePath={basePath}
        star={<StarButton workspaceSlug={workspaceSlug} projectId={projectId} starred={project.starred} />}
        menu={canManage && <ProjectMenu workspaceSlug={workspaceSlug} projectId={projectId} name={project.name} />}
      />
      <CalendarMonth
        workspaceSlug={workspaceSlug}
        month={month}
        weekStart={weekStart}
        today={today}
        tasks={tasks}
        taskHref="modal"
        showProject={false}
      />
      <ProjectTaskDialog
        ctx={ctx}
        taskId={openTaskId}
        projectId={projectId}
        statuses={project.statuses}
        workspaceSlug={workspaceSlug}
      />
    </main>
  );
}
```

- [ ] **Step 4: Add the My calendar route**

`src/app/(app)/[workspaceSlug]/calendar/page.tsx`:

```tsx
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { monthWeeks, parseMonth } from '@/components/calendar/month-grid';
import { todayInZone } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';

/** Tasks assigned to me across every active project, by due date. */
export default async function MyCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const { m } = await searchParams;
  const today = todayInZone(ctx.timezone);
  const month = parseMonth(m, today);
  const weekStart = await getWeekStart(ctx);
  const days = monthWeeks(month, weekStart).flat();
  const tasks = await listCalendarTasks(ctx, { from: days[0], to: days[days.length - 1], mine: true });

  return (
    <main className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="px-4 pt-6 lg:px-8">
        <h1 className="text-title-h5 text-text-strong-950">My calendar</h1>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">Tasks assigned to you, by due date.</p>
      </div>
      <CalendarMonth
        workspaceSlug={workspaceSlug}
        month={month}
        weekStart={weekStart}
        today={today}
        tasks={tasks}
        taskHref="page"
        showProject
      />
    </main>
  );
}
```

Match the heading classes to the `todo` page (`src/app/(app)/[workspaceSlug]/todo/page.tsx`) so both rail pages look alike.

- [ ] **Step 5: Tabs and rail**

`src/components/shell/ViewTabs.tsx` — import `IconCalendar`, add `const onCalendar = pathname.endsWith('/calendar');`, make Board active only when `!onSummary && !onList && !onCalendar`, and append:

```tsx
    { href: `${basePath}/calendar`, label: 'Calendar', icon: IconCalendar, active: onCalendar },
```

`src/components/shell/Rail.tsx` — add `IconCalendar, IconCalendarFilled` to the Tabler import and insert after the To-do entry:

```tsx
    { href: `/${workspaceSlug}/calendar`, label: 'My calendar', icon: IconCalendar, activeIcon: IconCalendarFilled },
```

- [ ] **Step 6: Verify**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: PASS.

Manual (dev server — the user's `next dev` usually owns :3000; if so run a second one on :3100 with `BETTER_AUTH_URL=http://localhost:3100`): open a project → Calendar tab, see tasks on their days; drag one to another day, reload, it stays; drag onto its own day or off the grid → nothing saved; Space on a chip, arrow, Space → moves; Enter opens the dialog; ‹ › change `?m=`; "+N more" opens; My calendar shows only my tasks and opens the task page; resize to phone width → list.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar src/app/'(app)'/'[workspaceSlug]'/calendar src/app/'(app)'/'[workspaceSlug]'/projects/'[projectId]'/calendar src/components/shell/ViewTabs.tsx src/components/shell/Rail.tsx
git commit -m "feat(calendar): project calendar tab and My calendar with drag to reschedule"
```

---

### Task 8: "Remind me" in the task dialog, and reminder preferences

**Files:**
- Create: `src/components/task/ReminderField.tsx`
- Create: `src/components/settings/ReminderPrefsForm.tsx`
- Modify: `src/components/task/TaskDetailView.tsx` (prop + field after `DueDateField`)
- Modify: `src/components/task/ProjectTaskDialog.tsx` (load my reminders)
- Modify: `src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx` (load my reminders)
- Modify: `src/app/(app)/settings/preferences/page.tsx` (render the form)
- Test: Task 9 e2e; this task ends with typecheck, lint, and the unit suite

**Interfaces:**
- Consumes: `listMyReminders` (Task 2), `setTaskRemindersAction` (Task 2), `getReminderPrefs`, `updateReminderPrefsAction` (Task 1), `REMINDER_OFFSETS`, `OFFSET_LABEL`, `REMINDER_CRON_HOURLY`, `hourLabel`, `type ReminderOffset` (Task 1)
- Produces: `TaskDetailViewProps.reminders: ReminderOffset[]`
- Produces: `ReminderField({ id, workspaceSlug, taskId, value, hasDueDate })`, `ReminderPrefsForm({ current }: { current: ReminderPrefs })`

- [ ] **Step 1: Build `ReminderField.tsx`**

```tsx
'use client';

import { IconBell, IconBellRinging, IconCheck } from '@tabler/icons-react';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as Dropdown from '@/components/ui/dropdown';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import { OFFSET_LABEL, REMINDER_OFFSETS, type ReminderOffset } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import { setTaskRemindersAction } from '@/server/reminders/actions';
import { cn } from '@/utils/cn';

/** My personal reminders on this task. Teammates never see them. */
export function ReminderField({
  id,
  workspaceSlug,
  taskId,
  value,
  hasDueDate,
}: {
  id: string;
  workspaceSlug: string;
  taskId: string;
  value: ReminderOffset[];
  hasDueDate: boolean;
}) {
  const [offsets, setOffsets] = useState(value);
  const [, startTransition] = useTransition();

  function toggle(offset: ReminderOffset) {
    const previous = offsets;
    const next = offsets.includes(offset) ? offsets.filter((o) => o !== offset) : [...offsets, offset].sort((a, b) => a - b);
    setOffsets(next);
    startTransition(async () => {
      const result = await settle(setTaskRemindersAction(workspaceSlug, { taskId, offsets: next }));
      if (!result.ok) {
        toast.error(result.error);
        setOffsets(previous);
      }
    });
  }

  const summary = offsets.length ? offsets.map((o) => OFFSET_LABEL[o]).join(', ') : 'No reminder';

  return (
    <div className="flex flex-col gap-1">
      <Label.Root htmlFor={id}>Remind me</Label.Root>
      <Dropdown.Root>
        <Dropdown.Trigger asChild disabled={!hasDueDate}>
          <button
            id={id}
            type="button"
            aria-describedby={hasDueDate ? undefined : `${id}-hint`}
            className={cn(
              'flex h-9 items-center gap-2 rounded-10 px-3 text-left text-paragraph-sm ring-1 ring-inset ring-stroke-soft-200',
              'hover:bg-bg-weak-50 disabled:cursor-not-allowed disabled:text-text-disabled-300',
            )}
          >
            {offsets.length && hasDueDate
              ? <IconBellRinging className="size-4 text-primary-base" aria-hidden="true" />
              : <IconBell className="size-4 text-text-soft-400" aria-hidden="true" />}
            <span className="truncate">{summary}</span>
          </button>
        </Dropdown.Trigger>
        <Dropdown.Content align="start">
          {REMINDER_OFFSETS.map((o) => (
            <DropdownPrimitive.CheckboxItem
              key={o}
              checked={offsets.includes(o)}
              // Keep the menu open so several can be picked in one go.
              onSelect={(event) => { event.preventDefault(); toggle(o); }}
              className="group/item relative flex cursor-pointer select-none items-center gap-2 rounded-lg p-2 text-paragraph-sm text-text-strong-950 outline-none data-[highlighted]:bg-bg-weak-50"
            >
              <span className="flex size-4 items-center justify-center">
                <DropdownPrimitive.ItemIndicator><IconCheck className="size-4" aria-hidden="true" /></DropdownPrimitive.ItemIndicator>
              </span>
              {OFFSET_LABEL[o]}
            </DropdownPrimitive.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Root>
      {!hasDueDate && <Hint.Root id={`${id}-hint`}>Set a due date to add a reminder.</Hint.Root>}
    </div>
  );
}
```

`src/components/ui/dropdown.tsx` also imports `@radix-ui/react-dropdown-menu`. Confirm the `Dropdown.Root`, `Dropdown.Trigger`, `Dropdown.Content` export names in its `export { … }` block (line ~173).

- [ ] **Step 2: Put it in the dialog**

`src/components/task/TaskDetailView.tsx`:
- Add `import { ReminderField } from '@/components/task/ReminderField';` and `import type { ReminderOffset } from '@/lib/reminders';`.
- Add to `TaskDetailViewProps`: `/** My own reminders on this task. */ reminders: ReminderOffset[];` and destructure `reminders` in `TaskDetailView`.
- Right after the `<DueDateField … />` element:

```tsx
          <ReminderField
            id="task-reminders"
            workspaceSlug={workspaceSlug}
            taskId={task.id}
            value={reminders}
            hasDueDate={dueDate !== null}
          />
```

`src/components/task/ProjectTaskDialog.tsx` — add `import { listMyReminders } from '@/server/reminders/service';`, extend the `Promise.all` with `listMyReminders(ctx, task.id)` as a fifth entry (`reminders`), and pass `reminders={reminders}` to `TaskDetailDialog`.

`src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx` — same: add `listMyReminders(ctx, task.id)` to its `Promise.all` and pass `reminders={reminders}` to `TaskDetailView`.

Run: `yarn typecheck` — expect PASS (any other `TaskDetailView` caller the compiler flags gets the same treatment).

- [ ] **Step 3: Build `ReminderPrefsForm.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import * as Switch from '@/components/ui/switch';
import { hourLabel, REMINDER_CRON_HOURLY } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import { updateReminderPrefsAction } from '@/server/user-settings/actions';
import type { ReminderPrefs } from '@/server/user-settings/service';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function ReminderPrefsForm({ current }: { current: ReminderPrefs }) {
  const router = useRouter();
  const [digestEnabled, setDigestEnabled] = useState(current.digestEnabled);
  const [reminderHour, setReminderHour] = useState(current.reminderHour);
  const [pending, setPending] = useState(false);

  const unchanged = digestEnabled === current.digestEnabled && reminderHour === current.reminderHour;

  async function onSave() {
    setPending(true);
    const result = await settle(updateReminderPrefsAction({ digestEnabled, reminderHour }));
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Reminder settings updated.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-bg-white-0 p-5 ring-1 ring-inset ring-stroke-soft-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label.Root htmlFor="digest-enabled">Daily digest</Label.Root>
          <Hint.Root>An email and a bell item listing your tasks due today and overdue.</Hint.Root>
        </div>
        <Switch.Root id="digest-enabled" checked={digestEnabled} onCheckedChange={setDigestEnabled} disabled={pending} />
      </div>

      <div className="flex flex-col gap-1">
        <Label.Root htmlFor="reminder-hour">Reminder time</Label.Root>
        <Select.Root value={String(reminderHour)} onValueChange={(v) => setReminderHour(Number(v))} disabled={pending}>
          <Select.Trigger id="reminder-hour" className="w-full sm:w-40" aria-describedby="reminder-hour-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {HOURS.map((h) => <Select.Item key={h} value={String(h)}>{hourLabel(h)}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="reminder-hour-hint">
          Your local time, for the digest and for reminders you set on tasks.
          {!REMINDER_CRON_HOURLY && ' Delivered once a day on the current plan.'}
        </Hint.Root>
      </div>

      <div>
        <Button.Root size="small" onClick={onSave} disabled={pending || unchanged}>
          {pending ? 'Saving…' : 'Save'}
        </Button.Root>
      </div>
    </div>
  );
}
```

`src/app/(app)/settings/preferences/page.tsx` — load both settings and render the form under the timezone one:

```tsx
import { ReminderPrefsForm } from '@/components/settings/ReminderPrefsForm';
import { UserTimezoneForm } from '@/components/settings/UserTimezoneForm';
import { requireUser } from '@/lib/session';
import { getReminderPrefs, getUserTimezone } from '@/server/user-settings/service';

// A static segment, so it wins over settings/[path] (which only knows auth views).
export default async function PreferencesPage() {
  const ctx = await requireUser();
  const [timezone, reminders] = await Promise.all([getUserTimezone(ctx), getReminderPrefs(ctx)]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">Preferences</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">How Taskeeper shows things to you.</p>
      </div>
      <UserTimezoneForm current={timezone} />
      <ReminderPrefsForm current={reminders} />
    </div>
  );
}
```

Two Save buttons are now on the page: `tests/e2e/preferences.spec.ts` uses `getByRole('button', { name: 'Save' })`. Scope it there to the timezone card — e.g. `page.getByRole('button', { name: 'Save' }).first()` — and run that spec in Task 9.

- [ ] **Step 4: Verify and commit**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: PASS.

```bash
git add src/components/task/ReminderField.tsx src/components/task/TaskDetailView.tsx src/components/task/ProjectTaskDialog.tsx src/components/settings/ReminderPrefsForm.tsx src/app/'(app)'/settings/preferences/page.tsx src/app/'(app)'/'[workspaceSlug]'/tasks/'[taskId]'/page.tsx tests/e2e/preferences.spec.ts
git commit -m "feat(reminders): remind-me field in the task dialog and reminder preferences"
```

---

### Task 9: End-to-end tests

**Files:**
- Create: `tests/e2e/calendar.spec.ts`
- Create: `tests/e2e/reminders.spec.ts`
- Modify: `playwright.config.ts` (`CRON_SECRET` in `webServer.env`)

**Interfaces:**
- Consumes: everything above; `createTask` helper from `tests/e2e/tasks.ts`

Run e2e locally before the PR (CI runs e2e only on PRs into master). If the user's `next dev` holds :3000, use a temporary config copy with `baseURL`/`url` on :3100, `PORT=3100` and `BETTER_AUTH_URL=http://localhost:3100`; do not commit that copy.

- [ ] **Step 1: Give the e2e server a cron secret**

`playwright.config.ts`, inside `webServer.env`:

```ts
      // Lets reminders.spec.ts trigger the reminders cron like Vercel does.
      CRON_SECRET: 'e2e-cron-secret',
```

- [ ] **Step 2: Write `tests/e2e/calendar.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Cal Tester');
  await page.getByLabel('Email', { exact: true }).fill(`cal-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Cal ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Launch');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible();
  return page.url();
}

/** Today in Asia/Yerevan (the workspace default), as the app sees it. */
function yerevanToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(now);
}

test('a task shows on its day and can be dragged to another day', async ({ page }) => {
  const projectUrl = await signUpWithProject(page);
  await createTask(page, 'Write launch post');

  // Give it a due date of today through the task dialog.
  await page.getByText('Write launch post').click();
  const details = page.getByRole('dialog', { name: 'Task details' });
  await details.getByLabel('Due date').click();
  await page.getByRole('menuitem', { name: 'Today' }).or(page.getByRole('button', { name: 'Today' })).first().click();
  await page.keyboard.press('Escape');

  await page.goto(`${projectUrl}/calendar`);
  const today = yerevanToday();
  const target = today.slice(0, 7) === yerevanToday(1).slice(0, 7) ? yerevanToday(1) : yerevanToday(-1);
  const chip = page.getByRole('gridcell', { name: today }).getByRole('button', { name: 'Write launch post' });
  await expect(chip).toBeVisible();

  // Dropping on the same day saves nothing.
  const cell = page.getByRole('gridcell', { name: today });
  await chip.dragTo(cell);
  await expect(page.getByRole('gridcell', { name: today }).getByRole('button', { name: 'Write launch post' })).toBeVisible();

  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/calendar'));
  await chip.dragTo(page.getByRole('gridcell', { name: target }));
  await saved;
  await page.reload();
  await expect(page.getByRole('gridcell', { name: target }).getByRole('button', { name: 'Write launch post' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: today }).getByRole('button', { name: 'Write launch post' })).toHaveCount(0);
});

test('My calendar shows only tasks assigned to me', async ({ page }) => {
  const projectUrl = await signUpWithProject(page);
  const workspaceUrl = projectUrl.replace(/\/projects\/.*/, '');
  await createTask(page, 'Mine');
  await createTask(page, 'Nobody’s');

  for (const [title, assign] of [['Mine', true], ['Nobody’s', false]] as const) {
    await page.getByText(title, { exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Task details' });
    await details.getByLabel('Due date').click();
    await page.getByRole('menuitem', { name: 'Today' }).or(page.getByRole('button', { name: 'Today' })).first().click();
    if (assign) {
      await details.getByLabel('Assignee').click();
      await page.getByRole('option', { name: /Cal Tester/ }).click();
    }
    await page.keyboard.press('Escape');
  }

  await page.goto(`${workspaceUrl}/calendar`);
  await expect(page.getByRole('heading', { name: 'My calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mine', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nobody’s' })).toHaveCount(0);
});
```

The due-date and assignee interactions above must match how `DueDateField` and `AssigneePicker` render (menu items vs buttons vs options). Before running, read `src/components/task/DueDateField.tsx` and an existing spec that sets a due date or assignee (`grep -rn "Due date\|Assignee" tests/e2e`) and use the same locators; drop the `.or(...)` once the right one is known.

- [ ] **Step 3: Write `tests/e2e/reminders.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithProject(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Rem Tester');
  await page.getByLabel('Email', { exact: true }).fill(`rem-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByLabel('Workspace name').fill(`Rem ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Ops');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible();
  return page.url();
}

test('preferences: digest switch and reminder hour persist', async ({ page }) => {
  await signUpWithProject(page);
  await page.goto('/settings/preferences');

  await page.getByLabel('Daily digest').click();
  await page.getByLabel('Reminder time').click();
  await page.getByRole('option', { name: '00:00' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Reminder settings updated.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Daily digest')).not.toBeChecked();
  await expect(page.getByLabel('Reminder time')).toHaveText('00:00');
});

test('a reminder set in the dialog reaches the bell after the cron runs', async ({ page }) => {
  await signUpWithProject(page);

  // Hour 00:00 makes "on the day" due as soon as the day starts.
  await page.goto('/settings/preferences');
  await page.getByLabel('Reminder time').click();
  await page.getByRole('option', { name: '00:00' }).click();
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Reminder settings updated.')).toBeVisible();
  await page.goBack();

  await createTask(page, 'Rotate keys');
  await page.getByText('Rotate keys').click();
  const details = page.getByRole('dialog', { name: 'Task details' });
  await expect(details.getByLabel('Remind me')).toBeDisabled();

  await details.getByLabel('Due date').click();
  await page.getByRole('menuitem', { name: 'Today' }).or(page.getByRole('button', { name: 'Today' })).first().click();
  await details.getByLabel('Remind me').click();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('menuitemcheckbox', { name: 'On the day' }).click();
  await saved;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const run = await page.request.get('/api/cron/reminders', {
    headers: { authorization: 'Bearer e2e-cron-secret' },
  });
  expect(run.ok()).toBe(true);

  await page.reload();
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByRole('link', { name: /Rotate keys/ });
  await expect(item).toContainText('Due today');
  await item.click();
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('the cron route refuses a caller without the secret', async ({ page }) => {
  const res = await page.request.get('/api/cron/reminders');
  expect(res.status()).toBe(401);
});
```

- [ ] **Step 4: Run e2e**

Run: `yarn e2e tests/e2e/calendar.spec.ts tests/e2e/reminders.spec.ts tests/e2e/preferences.spec.ts tests/e2e/board-drag.spec.ts tests/e2e/search.spec.ts`
Expected: PASS. Then the full `yarn e2e`.

If the drag test is flaky with `dragTo`, use the board spec's approach (`tests/e2e/board-drag.spec.ts`): `hover()` the chip, `mouse.down()`, move in steps past 8px, `hover()` the target cell, `mouse.up()`.

- [ ] **Step 5: Final checks and commit**

Run: `yarn typecheck && yarn lint && yarn test && graphify update .`

```bash
git add tests/e2e/calendar.spec.ts tests/e2e/reminders.spec.ts playwright.config.ts
git commit -m "test(e2e): calendar drag, my calendar, reminders through the cron to the bell"
```

PR (only when the user asks): base `develop`. The body must say: **run `yarn db:setup:prod` (and `yarn db:setup:dev`) BEFORE deploying** — new `reminder` and `notification` tables, `notification_kind` enum, and `user_settings.reminder_hour` / `digest_enabled`; `WorkspaceShell` reads `notification` on every page, so a missing table is a 500 everywhere. No new env vars. The reminders cron runs daily at 06:00 UTC on Hobby; on Pro, change `vercel.json` to `0 * * * *` and set `REMINDER_CRON_HOURLY = true`.
