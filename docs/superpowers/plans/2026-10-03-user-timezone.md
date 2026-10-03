# Per-user Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user set one timezone that overrides every workspace's zone for them, with "follow the workspace" as the default.

**Architecture:** A `user_settings` table holds a nullable zone per user. `resolveWorkspace` left-joins it, so `ctx.timezone` becomes the resolved per-user zone and every existing consumer picks it up unchanged; `ctx.workspaceTimezone` keeps the workspace's own zone. A new Account → Preferences tab edits the override through a `UserContext`-scoped service.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM on Postgres (`drizzle-kit push`, no migration files), Zod, Vitest (real test DB), Playwright, Align UI components, Tabler icons.

**Spec:** `docs/superpowers/specs/2026-10-03-user-timezone-design.md`

## Global Constraints

- Yarn 4; pinned dependency versions; no new dependencies.
- `ctx` first parameter on every `src/server/**` export: `WorkspaceContext`, or `UserContext` for account-level services.
- `Result<T>` across the action boundary (`withAction`, `ok`, `err` from `@/lib/result`).
- Dates through `src/lib/dates.ts`; tests run with `TZ=UTC`.
- No component imports from `src/db/`.
- Semantic Tailwind tokens only (`text-text-sub-600`, `bg-bg-white-0`, …); icons from `@tabler/icons-react`.
- New tables go into the `TRUNCATE` list in `tests/setup/db.ts`.
- TDD; Conventional Commits; never add a `Co-Authored-By` trailer; never push; never bump the version.
- Schema changes reach a database through `yarn db:setup` (dev) and `yarn db:setup:test` (test). Prod (`yarn db:setup:prod`) is run by the user, not by the implementer.
- Error copy for a bad zone, verbatim: `That is not a recognised timezone.`

## Review Focus

1. **Stored zone outside the curated list** (e.g. `Australia/Sydney` saved before the list existed): the select must still show it as selected, not blank. Pinned by `zoneOptions` tests in Task 2; used by both forms in Tasks 3 and 4.
2. **Admin who has an override opens workspace Settings → General:** the form must show and save the *workspace* zone, never theirs. Pinned by the e2e in Task 4.
3. **Clearing an override** (set, then back to "Follow"): `ctx.timezone` returns to the workspace zone. Pinned by the null-row tenancy test (Task 1) and the clear test (Task 2).
4. **Empty or junk zone string** (`''`, `'Mars/Olympus'`): rejected with the verbatim error and nothing written. Pinned in Task 2.
5. **User deleted:** their `user_settings` row goes with them (FK cascade). Pinned in Task 2.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/db/schema/settings.ts` | modify | add `userSettings` table |
| `tests/setup/db.ts` | modify | truncate `user_settings` |
| `src/lib/session.ts` | modify | `UserContext`, `workspaceTimezone`, join, `requireUser()` |
| `tests/server/*.test.ts` (ctx literals) | modify | add `workspaceTimezone` so they typecheck |
| `tests/server/tenancy.test.ts` | modify | resolution tests |
| `src/lib/dates.ts` | modify | `isValidTimezone` (moved here) |
| `src/lib/timezones.ts` | create | curated `ZONES`, `zoneOptions()` |
| `src/server/settings/service.ts` | modify | import `isValidTimezone` from dates |
| `src/server/user-settings/service.ts` | create | get/update the override |
| `src/server/user-settings/actions.ts` | create | server action |
| `tests/server/user-settings.test.ts` | create | service tests |
| `tests/unit/dates.test.ts`, `tests/unit/timezones.test.ts` | modify/create | helper tests |
| `src/components/settings/ZonePreview.tsx` | modify | label-driven preview |
| `tests/unit/relative-time.test.ts` | modify | `previewZones` new signature |
| `src/components/settings/UserTimezoneForm.tsx` | create | Preferences form |
| `src/app/(app)/settings/preferences/page.tsx` | create | Preferences route |
| `src/components/settings/SettingsTabs.tsx` | modify | Preferences tab |
| `src/app/(app)/settings/layout.tsx` | modify | subtitle copy |
| `src/components/settings/TimezoneForm.tsx` | modify | shared list, new hint, new preview call |
| `src/app/(app)/[workspaceSlug]/settings/general/page.tsx` | modify | pass `workspaceTimezone` |
| `tests/e2e/preferences.spec.ts` | create | end-to-end |
| `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md` | modify | constraint wording |

---

### Task 1: `user_settings` table and per-user resolution in `WorkspaceContext`

**Files:**
- Modify: `src/db/schema/settings.ts`
- Modify: `tests/setup/db.ts:9-16`
- Modify: `src/lib/session.ts`
- Modify: every `tests/server/*.test.ts` that builds a `WorkspaceContext` literal
- Test: `tests/server/tenancy.test.ts`

**Interfaces:**
- Produces:
  - `userSettings` table export from `@/db` with columns `userId: string`, `timezone: string | null`.
  - `type UserContext = { userId: string }` from `@/lib/session`.
  - `WorkspaceContext = UserContext & { workspaceId; slug; role; timezone: string; workspaceTimezone: string }`.
  - `requireUser(): Promise<UserContext>` from `@/lib/session`.

- [ ] **Step 1: Write the failing tests**

In `tests/server/tenancy.test.ts`, add `userSettings` to imports and `db` from setup:

```ts
import { closeDb, db, resetDb } from '../setup/db';
import { userSettings, workspaceSettings } from '@/db';
import { eq } from 'drizzle-orm';
```

Add inside `describe('resolveWorkspace', …)`, after the "carries the workspace timezone" test:

```ts
  it('without a user override, timezone and workspaceTimezone are both the workspace zone', async () => {
    const ada = await createUser('tz-none@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-tz-none');
    await db.update(workspaceSettings).set({ timezone: 'Europe/Berlin' })
      .where(eq(workspaceSettings.workspaceId, acme.id));

    const ctx = await resolveWorkspace(ada.id, 'acme-tz-none');

    expect(ctx!.timezone).toBe('Europe/Berlin');
    expect(ctx!.workspaceTimezone).toBe('Europe/Berlin');
  });

  it("a user's own timezone overrides the workspace zone for that user only", async () => {
    const ada = await createUser('tz-own@example.com');
    const bob = await createUser('tz-other@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-tz-own');
    await joinWorkspace(bob.id, acme.id, 'member');
    await db.insert(userSettings).values({ userId: ada.id, timezone: 'America/New_York' });

    const adaCtx = await resolveWorkspace(ada.id, 'acme-tz-own');
    const bobCtx = await resolveWorkspace(bob.id, 'acme-tz-own');

    expect(adaCtx!.timezone).toBe('America/New_York');
    expect(adaCtx!.workspaceTimezone).toBe('Asia/Yerevan');
    expect(bobCtx!.timezone).toBe('Asia/Yerevan');
  });

  it('a user row with a null timezone follows the workspace', async () => {
    const ada = await createUser('tz-null@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-tz-null');
    await db.insert(userSettings).values({ userId: ada.id, timezone: null });

    const ctx = await resolveWorkspace(ada.id, 'acme-tz-null');

    expect(ctx!.timezone).toBe('Asia/Yerevan');
    expect(ctx!.workspaceTimezone).toBe('Asia/Yerevan');
  });
```

Also update the existing ctx literal at `tests/server/tenancy.test.ts:92` (part of Step 5's sed).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/server/tenancy.test.ts`
Expected: FAIL — `userSettings` is not exported from `@/db` (import error / `undefined`).

- [ ] **Step 3: Add the table and push it**

Append to `src/db/schema/settings.ts` (add `user` to the `./auth` import):

```ts
import { organization, user } from './auth';

// Per-user preferences that are not workspace-scoped. A null timezone means
// "follow each workspace's zone"; resolveWorkspace applies the fallback.
export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  timezone: text('timezone'),
});
```

In `tests/setup/db.ts`, add `user_settings` to the TRUNCATE list, on the line with `workspace_settings`:

```ts
      workspace_settings, user_settings, invitation, member, organization,
```

Run: `yarn db:setup:test && yarn db:setup`
Expected: drizzle-kit reports creating table `user_settings`; no prompts about data loss.

- [ ] **Step 4: Resolve the per-user zone in `src/lib/session.ts`**

Replace the type and `resolveWorkspace`, and add `requireUser`. Add `userSettings` to the `@/db` import.

```ts
import { db, member, organization, userSettings, workspaceSettings } from '@/db';
```

```ts
/** Who is acting, for account-level services that have no workspace in the URL. */
export type UserContext = { userId: string };

export type WorkspaceContext = UserContext & {
  workspaceId: string;
  slug: string;
  role: WorkspaceRole;
  /** The zone this user sees dates in: their own if set, else the workspace's. */
  timezone: string;
  /** The workspace's zone, for anything that must be the same for every member. */
  workspaceTimezone: string;
};
```

In `resolveWorkspace`, select both zones and join the user's row:

```ts
  const [row] = await db
    .select({
      workspaceId: organization.id,
      slug: organization.slug,
      role: member.role,
      workspaceTimezone: workspaceSettings.timezone,
      userTimezone: userSettings.timezone,
    })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, userId)),
    )
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .leftJoin(userSettings, eq(userSettings.userId, userId))
    .where(eq(organization.slug, slug))
    .limit(1);

  if (!row) return null;

  const workspaceTimezone = row.workspaceTimezone ?? DEFAULT_TIMEZONE;
  return {
    userId,
    workspaceId: row.workspaceId,
    slug: row.slug,
    role: row.role as WorkspaceRole,
    timezone: row.userTimezone ?? workspaceTimezone,
    workspaceTimezone,
  };
```

After `signInRedirect`, add:

```ts
/** Account-level entry point: the signed-in user, or a redirect to sign in. */
export async function requireUser(): Promise<UserContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return signInRedirect();
  return { userId: session.user.id };
}
```

- [ ] **Step 5: Fix the hand-built ctx literals in tests**

Every test-built `WorkspaceContext` now needs `workspaceTimezone`. Each such literal sits on a line that also contains `role`; `updateWorkspaceSettings(…, { timezone: … })` calls do not, so they are left alone:

```bash
grep -rlE "role.*timezone: '" tests/server | xargs sed -i -E "/role/ s/timezone: '([^']+)'/timezone: '\1', workspaceTimezone: '\1'/"
```

Run: `yarn typecheck`
Expected: PASS (0 errors). If any literal was missed, the error names its file and line; add `workspaceTimezone` there by hand with the same value as `timezone`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run tests/server/tenancy.test.ts`
Expected: PASS, including the three new tests and the existing "defaulting to Asia/Yerevan" test.

Run: `yarn vitest run tests/server`
Expected: PASS (whole server suite; the fallback must be exact).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/settings.ts tests/setup/db.ts src/lib/session.ts tests/server
git commit -m "feat(timezone): resolve a per-user timezone override in WorkspaceContext"
```

---

### Task 2: Shared timezone helpers and the user-settings service

**Files:**
- Modify: `src/lib/dates.ts`
- Create: `src/lib/timezones.ts`
- Modify: `src/server/settings/service.ts:1-15`
- Create: `src/server/user-settings/service.ts`
- Create: `src/server/user-settings/actions.ts`
- Test: `tests/unit/dates.test.ts`, `tests/unit/timezones.test.ts`, `tests/server/user-settings.test.ts`

**Interfaces:**
- Consumes: `userSettings` (`@/db`), `UserContext`, `requireUser` (`@/lib/session`) from Task 1.
- Produces:
  - `isValidTimezone(tz: string): boolean` from `@/lib/dates`.
  - `ZONES: readonly string[]` and `zoneOptions(stored: string | null): string[]` from `@/lib/timezones`.
  - `getUserTimezone(ctx: UserContext): Promise<string | null>` from `@/server/user-settings/service`.
  - `updateUserTimezone(ctx: UserContext, timezone: string | null): Promise<Result<null>>` from `@/server/user-settings/service`.
  - `updateUserTimezoneAction(timezone: string | null): Promise<Result<null>>` from `@/server/user-settings/actions`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/dates.test.ts` (add `isValidTimezone` to its existing `@/lib/dates` import):

```ts
describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('rejects junk and the empty string', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});
```

Create `tests/unit/timezones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ZONES, zoneOptions } from '@/lib/timezones';

describe('zoneOptions', () => {
  it('is the curated list when nothing is stored', () => {
    expect(zoneOptions(null)).toEqual([...ZONES]);
  });

  it('does not duplicate a stored zone that is already listed', () => {
    expect(zoneOptions('UTC')).toEqual([...ZONES]);
  });

  it('appends a stored zone the list does not have, so the select can still show it', () => {
    expect(zoneOptions('Australia/Sydney')).toEqual([...ZONES, 'Australia/Sydney']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `yarn vitest run tests/unit/dates.test.ts tests/unit/timezones.test.ts`
Expected: FAIL — `isValidTimezone` is not exported from `@/lib/dates`; `@/lib/timezones` cannot be resolved.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/dates.ts`:

```ts
/** Asks the runtime whether a zone exists rather than shipping a list that goes stale. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

Note: `Intl.DateTimeFormat` throws a `RangeError` for `''`, so the empty string is rejected without a special case.

Create `src/lib/timezones.ts`:

```ts
// A short curated list. Intl.supportedValuesOf('timeZone') has ~400 entries,
// which is a worse control than a handful of relevant ones.
export const ZONES = [
  'Asia/Yerevan', 'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo',
] as const;

/** The curated zones, plus the stored one if it is not among them, so a select can still show it. */
export function zoneOptions(stored: string | null): string[] {
  const zones: string[] = [...ZONES];
  if (stored && !zones.includes(stored)) zones.push(stored);
  return zones;
}
```

In `src/server/settings/service.ts`, delete the local `isValidTimezone` function and import it instead:

```ts
import { isValidTimezone } from '@/lib/dates';
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `yarn vitest run tests/unit/dates.test.ts tests/unit/timezones.test.ts tests/server/members.test.ts`
Expected: PASS (members.test covers `updateWorkspaceSettings`, which now uses the moved helper).

- [ ] **Step 5: Write the failing service tests**

Create `tests/server/user-settings.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser } from '../setup/factories';
import { user, userSettings } from '@/db';
import { getUserTimezone, updateUserTimezone } from '@/server/user-settings/service';

beforeEach(resetDb);
afterAll(closeDb);

describe('user timezone', () => {
  it('is null until the user sets one', async () => {
    const ada = await createUser('ada-pref@example.com');
    expect(await getUserTimezone({ userId: ada.id })).toBeNull();
  });

  it('stores a zone and reads it back', async () => {
    const ada = await createUser('ada-set@example.com');

    const result = await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    expect(result.ok).toBe(true);
    expect(await getUserTimezone({ userId: ada.id })).toBe('Europe/Berlin');
  });

  it('replaces an earlier zone rather than adding a second row', async () => {
    const ada = await createUser('ada-replace@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    await updateUserTimezone({ userId: ada.id }, 'Asia/Tokyo');

    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, ada.id));
    expect(rows).toEqual([{ userId: ada.id, timezone: 'Asia/Tokyo' }]);
  });

  it('null clears the override so the user follows the workspace again', async () => {
    const ada = await createUser('ada-clear@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    const result = await updateUserTimezone({ userId: ada.id }, null);

    expect(result.ok).toBe(true);
    expect(await getUserTimezone({ userId: ada.id })).toBeNull();
  });

  it.each(['Mars/Olympus', ''])('rejects %j and writes nothing', async (zone) => {
    const ada = await createUser(`ada-bad-${zone.length}@example.com`);

    const result = await updateUserTimezone({ userId: ada.id }, zone);

    expect(result).toEqual({ ok: false, error: 'That is not a recognised timezone.' });
    expect(await db.select().from(userSettings)).toEqual([]);
  });

  it('goes away with the user', async () => {
    const ada = await createUser('ada-gone@example.com');
    await updateUserTimezone({ userId: ada.id }, 'Europe/Berlin');

    await db.delete(user).where(eq(user.id, ada.id));

    expect(await db.select().from(userSettings)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `yarn vitest run tests/server/user-settings.test.ts`
Expected: FAIL — `@/server/user-settings/service` cannot be resolved.

- [ ] **Step 7: Implement the service and the action**

Create `src/server/user-settings/service.ts`:

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, userSettings } from '@/db';
import { isValidTimezone } from '@/lib/dates';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { UserContext } from '@/lib/session';

/** The user's own zone, or null when they follow each workspace's. */
export async function getUserTimezone(ctx: UserContext): Promise<string | null> {
  const [row] = await db
    .select({ timezone: userSettings.timezone })
    .from(userSettings)
    .where(eq(userSettings.userId, ctx.userId))
    .limit(1);
  return row?.timezone ?? null;
}

/** Sets the user's own zone; null goes back to following the workspace. */
export async function updateUserTimezone(
  ctx: UserContext,
  timezone: string | null,
): Promise<Result<null>> {
  return withAction(async () => {
    const parsed = z.string().nullable().safeParse(timezone);
    if (!parsed.success) return err('That is not a recognised timezone.');
    if (parsed.data !== null && !isValidTimezone(parsed.data)) {
      return err('That is not a recognised timezone.');
    }

    await db
      .insert(userSettings)
      .values({ userId: ctx.userId, timezone: parsed.data })
      .onConflictDoUpdate({ target: userSettings.userId, set: { timezone: parsed.data } });

    return ok(null);
  });
}
```

Create `src/server/user-settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { withAction, type Result } from '@/lib/result';
import { requireUser } from '@/lib/session';
import { updateUserTimezone } from './service';

export async function updateUserTimezoneAction(timezone: string | null): Promise<Result<null>> {
  return withAction(async () => {
    const result = await updateUserTimezone(await requireUser(), timezone);
    // The zone applies in every workspace, so every page's dates may change.
    if (result.ok) revalidatePath('/', 'layout');
    return result;
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn vitest run tests/server/user-settings.test.ts && yarn typecheck`
Expected: PASS; 0 type errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/dates.ts src/lib/timezones.ts src/server/settings/service.ts src/server/user-settings tests/unit/dates.test.ts tests/unit/timezones.test.ts tests/server/user-settings.test.ts
git commit -m "feat(timezone): user-settings service to set or clear a personal timezone"
```

---

### Task 3: Account → Preferences tab

**Files:**
- Modify: `src/components/settings/ZonePreview.tsx`
- Modify: `tests/unit/relative-time.test.ts:18-29`
- Create: `src/components/settings/UserTimezoneForm.tsx`
- Create: `src/app/(app)/settings/preferences/page.tsx`
- Modify: `src/components/settings/SettingsTabs.tsx` (imports, `AccountSettingsTabs`)
- Modify: `src/app/(app)/settings/layout.tsx` (subtitle)
- Modify: `src/components/settings/TimezoneForm.tsx` (only the `ZonePreview` call, so it still compiles)

**Interfaces:**
- Consumes: `requireUser` (Task 1); `getUserTimezone`, `updateUserTimezoneAction`, `zoneOptions` (Task 2).
- Produces:
  - `previewZones(zone: { label: string; zone: string }, localZone: string): { label: string; zone: string }[]` and `ZonePreview({ label, zone })` from `@/components/settings/ZonePreview`.
  - `UserTimezoneForm({ current }: { current: string | null })`.
  - Route `/settings/preferences`.

- [ ] **Step 1: Update the `previewZones` test to the labelled signature**

Replace the `describe('previewZones', …)` block in `tests/unit/relative-time.test.ts`:

```ts
describe('previewZones', () => {
  it('shows the chosen zone under its label, and the viewer zone', () => {
    expect(previewZones({ label: 'Workspace time', zone: 'Europe/Berlin' }, 'Asia/Yerevan')).toEqual([
      { label: 'Workspace time', zone: 'Europe/Berlin' },
      { label: 'Your time', zone: 'Asia/Yerevan' },
    ]);
  });

  it('shows one line when they are the same', () => {
    expect(previewZones({ label: 'Chosen time', zone: 'UTC' }, 'UTC')).toEqual([
      { label: 'Chosen time', zone: 'UTC' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run tests/unit/relative-time.test.ts`
Expected: FAIL — the first case returns `Workspace time` for a string argument / type mismatch on the object argument.

- [ ] **Step 3: Generalise `ZonePreview`**

In `src/components/settings/ZonePreview.tsx`, replace `previewZones` and the component's signature (body otherwise unchanged):

```tsx
type LabelledZone = { label: string; zone: string };

export function previewZones(chosen: LabelledZone, localZone: string): LabelledZone[] {
  const zones = [chosen];
  if (localZone !== chosen.zone) zones.push({ label: 'Your time', zone: localZone });
  return zones;
}

/** Live clock for the chosen zone and the viewer's, so the setting's effect is visible. */
export function ZonePreview({ label, zone }: LabelledZone) {
```

and inside it:

```tsx
      {previewZones({ label, zone }, localZone).map(({ label, zone }) => (
```

In `src/components/settings/TimezoneForm.tsx`, change the call:

```tsx
      <ZonePreview label="Workspace time" zone={timezone} />
```

Run: `yarn vitest run tests/unit/relative-time.test.ts`
Expected: PASS.

- [ ] **Step 4: Build `UserTimezoneForm`**

Create `src/components/settings/UserTimezoneForm.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { ZonePreview } from '@/components/settings/ZonePreview';
import * as Button from '@/components/ui/button';
import * as Hint from '@/components/ui/hint';
import * as Label from '@/components/ui/label';
import * as Select from '@/components/ui/select';
import { zoneOptions } from '@/lib/timezones';
import { settle } from '@/lib/settle';
import { updateUserTimezoneAction } from '@/server/user-settings/actions';

// Radix Select cannot hold an empty value, so "no override" needs a sentinel.
const FOLLOW = 'follow';

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function UserTimezoneForm({ current }: { current: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState(current ?? FOLLOW);
  const [pending, setPending] = useState(false);
  // The browser zone only exists on the client.
  const localZone = useSyncExternalStore(() => () => {}, browserZone, () => null);

  const saved = current ?? FOLLOW;
  const options = zoneOptions(choice === FOLLOW ? current : choice);

  async function onSave() {
    setPending(true);
    const result = await settle(updateUserTimezoneAction(choice === FOLLOW ? null : choice));
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
        <Label.Root htmlFor="user-timezone">Your timezone</Label.Root>
        <Select.Root value={choice} onValueChange={setChoice} disabled={pending}>
          <Select.Trigger id="user-timezone" className="w-full sm:w-72" aria-describedby="user-timezone-hint">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={FOLLOW}>Follow each workspace&rsquo;s timezone</Select.Item>
            {options.map((zone) => <Select.Item key={zone} value={zone}>{zone}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Hint.Root id="user-timezone-hint">
          Due dates and &ldquo;today&rdquo; are shown in this timezone in every workspace.
        </Hint.Root>
      </div>

      {localZone && localZone !== choice && (
        <div>
          <Button.Root size="small" variant="neutral" mode="stroke" onClick={() => setChoice(localZone)} disabled={pending}>
            Use {localZone}
          </Button.Root>
        </div>
      )}

      {choice !== FOLLOW && <ZonePreview label="Chosen time" zone={choice} />}

      <div>
        <Button.Root size="small" onClick={onSave} disabled={pending || choice === saved}>
          {pending ? 'Saving…' : 'Save'}
        </Button.Root>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the route, tab and copy**

Create `src/app/(app)/settings/preferences/page.tsx`:

```tsx
import { UserTimezoneForm } from '@/components/settings/UserTimezoneForm';
import { requireUser } from '@/lib/session';
import { getUserTimezone } from '@/server/user-settings/service';

// A static segment, so it wins over settings/[path] (which only knows auth views).
export default async function PreferencesPage() {
  const timezone = await getUserTimezone(await requireUser());

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">Preferences</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">How Taskeeper shows things to you.</p>
      </div>
      <UserTimezoneForm current={timezone} />
    </div>
  );
}
```

In `src/components/settings/SettingsTabs.tsx`, add `IconClock` to the Tabler import and a third account tab:

```tsx
        { label: 'Preferences', href: '/settings/preferences', icon: IconClock },
```

In `src/app/(app)/settings/layout.tsx`, change the subtitle:

```tsx
          <p className="mt-1 text-paragraph-sm text-text-sub-600">Your profile, sign-in, sessions and preferences.</p>
```

- [ ] **Step 6: Verify in the type checker, linter and a browser**

Run: `yarn typecheck && yarn lint && yarn vitest run tests/unit`
Expected: PASS, 0 errors.

Then run the app (use the `run` skill; if `:3000` is taken by the user's `next dev`, start on `:3100` with `BETTER_AUTH_URL=http://localhost:3100`). Sign in, open `/settings/preferences`, and check: the tab is active; "Follow each workspace's timezone" is selected; picking `Europe/Berlin` shows the preview and enables Save; Save toasts "Timezone updated."; reload keeps `Europe/Berlin`; a task's created stamp on a board now renders in Berlin time; choosing Follow and saving reverts it. Check light and dark themes and a 375px-wide viewport.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings src/app/\(app\)/settings tests/unit/relative-time.test.ts
git commit -m "feat(timezone): Preferences tab to choose a personal timezone"
```

---

### Task 4: Workspace form shows the workspace zone; e2e; roadmap note

**Files:**
- Modify: `src/app/(app)/[workspaceSlug]/settings/general/page.tsx:21`
- Modify: `src/components/settings/TimezoneForm.tsx` (list, hint)
- Create: `tests/e2e/preferences.spec.ts`
- Modify: `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md:77-78`

**Interfaces:**
- Consumes: `ctx.workspaceTimezone` (Task 1), `zoneOptions` (Task 2), Preferences UI labels from Task 3 (`Your timezone`, `Save`, toast `Timezone updated.`).

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/preferences.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function signUpWithWorkspace(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Zone Tester');
  await page.getByLabel('Email', { exact: true }).fill(`prefs-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Prefs ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  return page.url();
}

test('a personal timezone is saved and leaves the workspace timezone alone', async ({ page }) => {
  const workspaceUrl = await signUpWithWorkspace(page);

  await page.goto('/settings/preferences');
  const zone = page.getByLabel('Your timezone');
  await expect(zone).toHaveText("Follow each workspace’s timezone");

  await zone.click();
  await page.getByRole('option', { name: 'Europe/Berlin' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Timezone updated.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Your timezone')).toHaveText('Europe/Berlin');

  // The owner has an override, but the workspace form must show the workspace's zone.
  await page.goto(`${workspaceUrl}/settings/general`);
  await expect(page.getByLabel('Workspace timezone')).toHaveText('Asia/Yerevan');

  await page.goto('/settings/preferences');
  await page.getByLabel('Your timezone').click();
  await page.getByRole('option', { name: "Follow each workspace’s timezone" }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Timezone updated.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your timezone')).toHaveText("Follow each workspace’s timezone");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn e2e tests/e2e/preferences.spec.ts`

Playwright's `webServer` builds and starts on `:3000` and reuses a server already there. If the user's `next dev` holds `:3000` (check with `ss -ltnp | grep 3000`), do not reuse it: copy `playwright.config.ts` to a scratch config with `baseURL`/`url` on `http://localhost:3100`, `command: 'yarn build && yarn start -p 3100'`, and `BETTER_AUTH_URL: 'http://localhost:3100'` in the server env, then run `yarn playwright test -c <scratch config> tests/e2e/preferences.spec.ts`. Same for the full run in Step 4.
Expected: FAIL at `toHaveText('Asia/Yerevan')` — the General form shows `Europe/Berlin` because it is fed `ctx.timezone`.

- [ ] **Step 3: Feed the workspace form the workspace zone**

In `src/app/(app)/[workspaceSlug]/settings/general/page.tsx`:

```tsx
        current={ctx.workspaceTimezone}
```

In `src/components/settings/TimezoneForm.tsx`: delete the local `ZONES` constant and its comment, import the helper, use it for the items, and reword the hint:

```tsx
import { zoneOptions } from '@/lib/timezones';
```

```tsx
            {zoneOptions(current).map((zone) => <Select.Item key={zone} value={zone}>{zone}</Select.Item>)}
```

```tsx
        <Hint.Root id="timezone-hint">
          Default for members who haven&rsquo;t set their own timezone.
        </Hint.Root>
```

- [ ] **Step 4: Run the e2e and the full suites**

Run: `yarn e2e tests/e2e/preferences.spec.ts`
Expected: PASS.

Run: `yarn typecheck && yarn lint && yarn test && yarn e2e`
Expected: all PASS (CI no longer runs e2e on PRs into develop, so the full local e2e run is the gate).

- [ ] **Step 5: Record the convention change in the roadmap**

In `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`, replace

```
component imports from `src/db/`, `ctx: WorkspaceContext` first parameter on every
`src/server/**` export, `Result<T>` across the action boundary, semantic Tailwind tokens,
```

with

```
component imports from `src/db/`, `ctx: WorkspaceContext` first parameter on every
`src/server/**` export (or `ctx: UserContext` for account-level services with no workspace
in the URL, since slice 2), `Result<T>` across the action boundary, semantic Tailwind tokens,
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/\[workspaceSlug\]/settings/general/page.tsx src/components/settings/TimezoneForm.tsx tests/e2e/preferences.spec.ts docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md
git commit -m "feat(timezone): workspace settings edit the workspace zone, not the viewer's"
```

After this task: run `graphify update .`, then stop. Do not push or open the PR; report to the user, who will also need to run `yarn db:setup:prod` when this reaches production.
