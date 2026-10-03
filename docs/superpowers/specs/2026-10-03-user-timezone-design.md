# Per-user timezone — design

Roadmap item 7 (slice 2), `docs/superpowers/plans/2026-09-23-taskeeper-v2-roadmap.md`.
Must land before slice 5 (reminders), which sends at the recipient's local hour.

## Goal

Each user can set their own timezone. A user who sets none follows each workspace's
timezone exactly as today. The resolved zone drives everything `ctx.timezone` drives now:
"today", overdue, due chips, created/updated stamps, the to-do page.

Due dates stay plain calendar dates (`date` column). Nothing is shifted; only the viewer's
"today" changes.

Success: a user in another zone sees their own "today" and overdue state; a user with no
override sees no change; every existing timezone test stays green unchanged.

## Decisions

- **Scope:** one zone per user, global across workspaces. Not per membership.
- **Where it is set:** new Account → Preferences tab. No silent auto-detection; the browser
  zone is offered as a one-click suggestion.
- **Resolution:** inside `resolveWorkspace` (one left join), so every existing consumer of
  `ctx.timezone` gets the per-user value without call-site changes.

Rejected: a second lookup in `requireWorkspace` (extra query; `resolveShellWorkspace` would
miss the override); browser-only zone with no storage (server-rendered dates mismatch,
reminders need a server-known zone).

## Data

`src/db/schema/settings.ts`:

```ts
export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  timezone: text('timezone'), // null = follow the workspace
});
```

Drizzle migration generated with the usual script. Exported from `src/db`.

## Context

`src/lib/session.ts`:

```ts
export type UserContext = { userId: string };

export type WorkspaceContext = UserContext & {
  workspaceId: string;
  slug: string;
  role: WorkspaceRole;
  timezone: string;          // resolved: user ?? workspace ?? DEFAULT_TIMEZONE
  workspaceTimezone: string; // workspace ?? DEFAULT_TIMEZONE
};
```

`resolveWorkspace` adds `.leftJoin(userSettings, eq(userSettings.userId, userId))` and
selects `userSettings.timezone`. With no row or a null value the output is identical to
today's, apart from the new `workspaceTimezone` field.

`requireUser(): Promise<UserContext>` — session or `signInRedirect()`. Used by actions on
account-level pages, which have no workspace slug.

**Convention exception:** the global rule "`ctx: WorkspaceContext` first on every
`src/server/**` export" becomes "`ctx: WorkspaceContext`, or `ctx: UserContext` for
account-level services". `WorkspaceContext` satisfies `UserContext`, so either can be passed.
Recorded in the roadmap's constraints section.

## Server

`isValidTimezone` moves from `src/server/settings/service.ts` to `src/lib/dates.ts` and is
shared.

`src/server/user-settings/service.ts`:

- `getUserTimezone(ctx: UserContext): Promise<string | null>`
- `updateUserTimezone(ctx: UserContext, timezone: string | null): Promise<Result<null>>` —
  Zod (`z.string().nullable()`), invalid zone → `err('That is not a recognised timezone.')`.
  Upsert on `user_id` (`onConflictDoUpdate`); `null` stores null, which means "follow".

`src/server/user-settings/actions.ts`:

- `updateUserTimezoneAction(timezone: string | null)` → `requireUser()`, service, then
  `revalidatePath('/', 'layout')` on success (the zone affects every workspace).

## UI

- `src/lib/timezones.ts`: the curated `ZONES` list, extracted
  so both forms share it. A stored zone not in the list is appended so it still displays.
- Route `src/app/(app)/settings/preferences/page.tsx`. A static segment, so it wins over
  `settings/[path]`. Server component: `requireUser()`, `getUserTimezone`, renders the form.
- `AccountSettingsTabs` gains a third tab: Preferences, `IconClock`.
- `UserTimezoneForm` (client):
  - Select: "Follow each workspace's timezone" (value → `null`) plus the zones.
  - When the browser zone differs from the selection, a small button "Use <browser zone>"
    sets the select to it.
  - Live preview reuses `ZonePreview` (generalised to take labelled zones) showing the chosen
    zone against the browser's.
  - Save disabled while pending or unchanged; errors toast, success toasts and
    `router.refresh()`.
- Workspace Settings → General: `TimezoneForm current={ctx.workspaceTimezone}` (otherwise
  an admin with an override would see, and could save, their own zone as the workspace's).
  Hint becomes: "Default for members who haven't set their own timezone."

## Errors

Invalid zone → `Result` error, shown as a toast. Unauthenticated action → sign-in redirect.
No other failure modes beyond the DB.

## Testing (TDD)

Server (real DB, `tests/server/`):

- `tenancy.test.ts`: no `user_settings` row → `timezone` = workspace zone,
  `workspaceTimezone` = workspace zone; override row → `timezone` = user zone,
  `workspaceTimezone` unchanged; row with null → workspace zone.
- `user-settings.test.ts`: set, read, clear with null; invalid zone rejected and nothing
  written; deleting the user cascades the row.

Unit: `isValidTimezone` in `dates.test.ts`; the "append stored zone" helper.

E2E (`tests/e2e/preferences.spec.ts`): pick a zone on Preferences, save, reload — the
selection persists and Settings → General still shows the workspace zone; reset to
"Follow". It does not assert a changed "today": whether two zones disagree on the date
depends on the clock at test time, so that logic is covered by the server tests instead.

## Out of scope

Week start per user, date/time format preferences, auto-detection, per-workspace overrides.
