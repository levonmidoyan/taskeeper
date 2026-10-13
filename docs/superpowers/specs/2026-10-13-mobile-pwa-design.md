# Mobile PWA — Design

**Roadmap item:** 14b (slice 10, mobile half).
**Branch:** `feat/mobile-pwa` off `develop`, PR into `develop`.
**Date:** 2026-10-13. Approved in conversation section by section.

## 1. Goal

Make Taskeeper usable from the phones of the team that already uses it: installable to the
home screen, comfortable at 375 px wide, and able to buzz the phone when something needs the
user — without an app store, a second codebase or a new vendor.

**Success:** a teammate opens Taskeeper on an iPhone or Android phone, adds it to the home
screen, turns on push in Account → Preferences, and when someone @mentions them a
notification arrives within seconds; tapping it opens the task. On the phone they can move
between To-do, Inbox, projects and search from a bottom bar, create a task with one tap,
move a board card to another status, and see their month as an agenda.

**Decisions taken:**

| Question | Decision |
|---|---|
| Audience | The user's own team (internal), no store presence needed |
| Client | Installable PWA on the existing Next.js app; no native app, no Expo |
| Scope | (1) installable shell, (2) mobile layout pass, (3) web push. Offline read cache out (YAGNI) |
| What pushes | Per-kind toggles per user: reminders, mentions, task changes (includes reactions), project changes. Digest never pushes |
| Phone navigation | Existing left drawer stays + bottom tab bar below `lg` |
| Views on phone | Board snap columns + Move to…; List stacked rows; Calendar agenda below `sm`; Summary single column; task detail fields first; To-do drag fixed |
| Delivery | Post-commit `after()` send with `web-push`, no outbox, no retries; no third-party push service |

**Non-goals:** offline data or offline edits, background sync, native app or bearer-session
auth (the 14a authenticator keeps its door open for that), emailing change notifications,
drag on the calendar agenda, per-device kind toggles, install prompts beyond the browser's own.

## 2. Installable shell

### 2.1 Manifest and metadata

- `src/app/manifest.ts` (`MetadataRoute.Manifest`): `name: 'Taskeeper'`,
  `short_name: 'Taskeeper'`, `start_url: '/'`, `display: 'standalone'`, `scope: '/'`,
  `theme_color` / `background_color` from the indigo brand tokens (light values).
- Icons: 192 px, 512 px and 512 px `purpose: 'maskable'` PNGs rendered from
  `src/app/icon.svg` into `public/icons/` (committed; a one-off script in `scripts/` makes them).
- Root `src/app/layout.tsx`:
  - `export const viewport`: `themeColor` per colour scheme (light and dark tokens),
    `viewportFit: 'cover'`.
  - `metadata.appleWebApp`: `capable: true`, `title: 'Taskeeper'`,
    `statusBarStyle: 'default'`.
- Safe-area insets (`env(safe-area-inset-*)`) padded on the sticky header and the bottom bar.

### 2.2 Service worker

`public/sw.js`, hand-written (no Serwist / next-pwa). Three handlers, nothing cached
except the offline page:

- `install`: caches `/offline` only; `skipWaiting()`.
- `activate`: deletes old caches; `clients.claim()`.
- `fetch`: navigations only (`request.mode === 'navigate'`): network first; on network
  failure respond with the cached `/offline`. All other requests pass through untouched.
- `push`: reads `{ title, body, url, tag }` JSON, `showNotification(title, { body, tag,
  data: { url }, icon, badge })`. `tag` is the notification id, so a merged update replaces
  the earlier banner.
- `notificationclick`: closes the notification; finds a same-origin window client, calls
  `navigate(url)` + `focus()`; else `clients.openWindow(url)`.

Registered once by a client `ServiceWorkerRegister` component mounted in the root layout
(`navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`),
production builds and `next start` only — not under `next dev`, so dev HMR is untouched.
`next.config.ts` serves `/sw.js` with `Cache-Control: no-cache` and
`Content-Type: application/javascript`.

`src/app/offline/page.tsx`: static page, "You're offline", Retry button
(`location.reload()`). Outside the auth check.

## 3. Push data

### 3.1 Schema

```
push_subscription
  id            text pk
  user_id       text not null → user.id on delete cascade
  endpoint      text not null unique
  p256dh        text not null
  auth          text not null
  user_agent    text
  created_at    timestamptz not null default now()
  last_used_at  timestamptz
  index (user_id)
```

One row per browser/device. `user_settings` gains four columns:

| Column | Default | Kinds |
|---|---|---|
| `push_reminders` | true | `reminder` |
| `push_mentions` | true | `mention` |
| `push_task_changes` | true | `task_change` (incl. reactions) |
| `push_project_changes` | false | `project_change` |

`digest` never pushes. A user with no `user_settings` row gets the defaults.

The existing `change_notify` toggle keeps deciding whether change rows exist at all; push
toggles only decide whether an existing row also pushes.

### 3.2 Server (`src/server/push/`)

- `service.ts`:
  - `subscribe(user, sub, userAgent)`: Zod-validated `{ endpoint (https URL), keys: { p256dh, auth } }`; upsert on
    `endpoint`, setting `user_id` to the caller (an endpoint moves with whoever signed in
    on that browser last).
  - `unsubscribe(user, endpoint)`: deletes the row only if it is the caller's.
  - `updatePushPrefs(user, prefs)`: the four booleans.
  - `sendTest(user)`: pushes "Push is working" to all the caller's subscriptions.
- `actions.ts`: the four as server actions (`requireUser()`), returning the usual `Result`.
- `config.ts`: reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; returns
  `null` when any is missing (then nothing sends and the UI says push is not configured).

### 3.3 Preferences UI

Account → Preferences gets a **Push notifications** card (`PushPrefsForm.tsx`), next to the
existing reminder/change prefs:

- **This device** switch. On: `Notification.requestPermission()` (from the tap),
  `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then the
  `subscribe` action. Off: `subscription.unsubscribe()` + `unsubscribe` action. State is read
  from `pushManager.getSubscription()` on mount.
- States with their own copy: not configured (no VAPID key), not supported, iOS not
  installed ("Add Taskeeper to your Home Screen first", detected by iOS UA +
  `!matchMedia('(display-mode: standalone)').matches`), permission denied ("Allow
  notifications for this site in your browser settings").
- Four per-kind switches (apply to all the user's devices), saved like the existing form.
- **Send test** button, enabled when this device is subscribed.

The public key reaches the client as a prop from the server page (like the Pusher key), not
through a `NEXT_PUBLIC_*` variable.

## 4. Push delivery

### 4.1 Capture, inside the transaction

The four notification insert sites return what they wrote:

- `notifyTaskChange`, `notifyMentions`, `notifyProjectChange`
  (`src/server/notifications/changes.ts`): add `RETURNING id, created_at`.
- `insertDrafts` (`src/server/reminders/select.ts`): add `created_at` to its `RETURNING`.

Every insert and every merge sets `created_at = clock_timestamp()`, so `(id, created_at)` is
a version stamp for what this statement wrote. The three `changes.ts` functions hand their
pairs to `schedulePush(pairs)` (`src/server/push/schedule.ts`), which collects pairs per
request and registers one `after(() => deliverPush(collected))`. Outside a request scope
(seed, scripts) `schedulePush` does nothing.

### 4.2 Send, after the response

`deliverPush(pairs)` (`src/server/push/deliver.ts`):

1. Returns at once if VAPID config is missing or `pairs` is empty.
2. One query: `notification` where `(id, created_at) IN pairs`, joined to `organization`
   (slug), left-joined to `user_settings`, joined to `push_subscription` on `user_id`.
   - A rolled-back write has no row; a stale stamp means a later merge wrote the row again
     and schedules its own push. Both are skipped, so `after()` running on rollback is
     harmless.
   - Rows whose kind toggle is off (mapping in 3.1) are dropped, as are `cleared_at` rows.
3. `pushMessage(row)` (`src/server/push/message.ts`) builds `{ title, body, url, tag }`:
   - Text follows the bell's copy for each kind (e.g. title "Fix login", body "Anna changed
     status to Done"; mention "Anna mentioned you in a comment"; reminder "Due tomorrow";
     project change "Anna archived Website").
   - `url`: the task page `/{slug}/tasks/{taskId}` when the row has a task; the project page
     when it has a project that still exists; else `/{slug}/inbox`.
   - `tag`: the notification id. Payload under 3 KB (body truncated to 180 chars).
4. Sends with `web-push` (`TTL: 86400`; `urgency: 'high'` for mention and reminder, `'normal'`
   otherwise), at most 6 in flight.
   - 404 / 410: delete that subscription.
   - Success: set `last_used_at = now()` (one update per batch).
   - Any other error: logged and dropped. The bell/Inbox still has the item.
5. Never throws.

### 4.3 Cron

`runReminders` (`src/server/reminders/run.ts`) calls `deliverPush` directly with the pairs
`claimNotifications` returned, after the claim commits, before emailing.

### 4.4 Reading

Tapping a notification does not mark it read. It reads as read the way bell items do today.

## 5. Mobile layout

### 5.1 Bottom tab bar

`src/components/shell/BottomBar.tsx`, rendered by `WorkspaceShell` below `lg` only:

- Fixed to the bottom, `h-14` + bottom safe-area padding; the shell's main column gets the
  same bottom padding below `lg`.
- Slots: **Projects** (opens the left drawer), **To-do** (`/{slug}/todo`), **＋** (opens
  `CreateTaskDialog`), **Search** (opens the ⌘K palette), **Inbox** (`/{slug}/inbox`, unread
  badge from the bell snapshot).
- `MobileNav`'s open state is lifted so both the header hamburger and the Projects tab open
  it. The hamburger stays for `sm`–`lg` widths.
- Active link has `aria-current="page"`; the bar is a `nav` with `aria-label="Primary"`.
- Hidden while the on-screen keyboard is open (`visualViewport.height` below 75% of
  `innerHeight`), so it never covers a composer.
- Touch targets at least 44 × 44 px.

### 5.2 Inbox page

`src/app/(app)/[workspaceSlug]/inbox/page.tsx`: the bell's list as a full page (same item
component, mark read, mark all read, clear). Below `sm` the header bell links to Inbox
instead of opening its popover; desktop keeps the popover.

### 5.3 Views

| View | Below `sm` (640 px) unless stated |
|---|---|
| Board | Columns `w-[85vw]`, horizontal `snap-x snap-mandatory`. Touch drag unchanged (250 ms / 5 px). Card menu gains **Move to…** listing the project's statuses; calls the existing status update. |
| List | Stacked rows: title, StatusIcon, assignee avatar, due date; other columns hidden. Long-press (500 ms) enters selection mode, then taps toggle; bulk bar as today. |
| Calendar | Renders `CalendarAgenda`: the visible month's days that have tasks, grouped by date, with the month navigation. No drag. `CalendarMonth` from `sm` up. A new `useMediaQuery` (`src/lib/use-media-query.ts`) picks one, so only one is mounted. |
| Summary | Single column. |
| Task detail | Below `md`: the field panel (status, assignee, dates, labels) above the description. |
| To-do | `PointerSensor` replaced with Mouse (8 px) + Touch (250 ms / 5 px) + Keyboard sensors, like Board. |

## 6. Configuration and deploy

- New dependency: `web-push` (+ `@types/web-push`).
- Env per Vercel environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (`mailto:` address). Generate with `npx web-push generate-vapid-keys`.
  Missing vars: push is off, everything else works.
- Database: `yarn db:setup:dev` / `yarn db:setup:prod` before deploying (new table + four
  `user_settings` columns).
- e2e runs without VAPID keys except the push spec, which sets test keys.

## 7. Testing

**Vitest**
- `pushMessage`: copy, url and tag per kind, including deleted project / task fallbacks and
  truncation.
- Kind → toggle mapping; digest never pushes; defaults for a user without settings.
- `deliverPush`: rolled-back pair (no row) and stale pair (merged since) are skipped; 404/410
  deletes the subscription; other errors do not throw; `last_used_at` set on success
  (`web-push` mocked).
- `subscribe` re-owns an endpoint from another user; `unsubscribe` ignores someone else's
  endpoint; prefs action validation.
- `changes.ts` and `insertDrafts` return the pairs they wrote (insert and merge).

**Playwright**
- New `mobile` project (`devices['iPhone 13']` on Chromium) for `tests/e2e/mobile.spec.ts`:
  bottom bar navigation, ＋ creates a task, Inbox lists and marks read, board Move to…,
  calendar agenda shows a task, task detail fields above description.
- `push.spec.ts` (desktop Chromium, notifications permission granted): manifest served,
  service worker registers, This device switch stores a subscription row (stubbing
  `PushManager.subscribe` if headless push is unreliable), Send test reaches `deliverPush`.

**Manual (owed by the user)**
- Install on a real iPhone (iOS 16.4+) and an Android phone; enable push; a teammate
  @mentions you; the notification arrives and opens the task.

## 8. Risks

- iOS standalone PWAs lose push permission if the user deletes and re-adds the icon; the
  This device switch reads the real subscription on mount, so it shows Off again.
- No retries: a push lost to a provider error is not resent. Acceptable for an internal
  team; the bell is the source of truth.
- `after()` budget on Vercel: sends run after the response within the function's duration;
  at team scale (a handful of devices per notification) this is milliseconds.
