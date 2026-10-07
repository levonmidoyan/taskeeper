# Pusher live refresh — design

Builds on `2026-10-04-live-refresh-design.md`. Pusher Channels becomes the primary way open
pages learn that a workspace changed; polling stays as the fallback and as a slow safety net.

## Goal

A teammate's change reaches my screen in about a second instead of up to 30 s. When Pusher
is unconfigured, unreachable or misconfigured (bad key, bad secret, outage), the app falls
back to today's polling without showing the user anything.

Success:

- With Pusher healthy, a change shows on other members' open tabs within ~1 s (still
  deferred while they drag, type or have a request in flight).
- With Pusher env vars missing, behaviour is exactly today's polling (local dev without
  keys, CI, e2e).
- Invalid client key, invalid server secret/app id, blocked websocket or Pusher outage:
  clients drop to 30 s polling on their own and return to Pusher when it recovers.
- A publish lost while the socket looks healthy is caught by a 5 min safety poll or the
  next tab focus.

## Decisions (user, 2026-10-07)

- **Fallback:** Pusher primary plus a slow safety poll (5 min + on focus/visible) while
  Pusher is healthy; 30 s polling (today's cadence) whenever it is not.
- **Environments:** one Pusher app per environment, used everywhere (dev and prod). E2E runs
  without Pusher env, on polling, to stay hermetic.
- **Scope:** stays workspace-wide. `projectId` is not used for filtering. Bursts of events
  are coalesced with a ~500 ms debounce.
- **Publish point:** after the response via Next's `after()`, publishing the *committed*
  counter, not the value seen inside the transaction (see below).
- **Branch:** `feat/v2-updates`.

## Why publish the committed counter

`after()` runs even when the request failed or the transaction rolled back. If `emitChange`
published the version returned inside the transaction and that transaction rolled back,
clients would mark a version as on screen that never existed, then ignore the real one when
it arrived. So the `after()` callback reads `workspace_change.version` from the database and
publishes that. A rolled-back write re-sends the current version, which every client already
has, and is ignored. No change to the 52 `emitChange` call sites and no commit hooks.

Publishing inside the transaction is rejected: clients would refresh before the commit and
render stale data.

## Configuration

| var | notes |
|---|---|
| `PUSHER_APP_ID` | |
| `PUSHER_KEY` | public; the workspace layout passes it to the browser |
| `PUSHER_SECRET` | |
| `PUSHER_CLUSTER` | e.g. `eu`; passed to the browser with the key |

Pusher is on only when all four are set, on server and client alike: the layout reads them at
request time and gives `LiveRefresh` `{ key, cluster }` or `null`. No `NEXT_PUBLIC_*` vars, so
nothing is inlined at build time. Added to `.env.example`. No DB migration.

## Server

### `src/server/changes/pusher.ts` (new)

- `pusherConfigured(): boolean` from env.
- Lazy singleton client from the official `pusher` Node SDK.
- `workspaceChannel(workspaceId)` → `private-workspace-<workspaceId>`; `parseWorkspaceChannel(name)`
  → id or `null`. Shared with the client through a small module with no server imports
  (`src/lib/live/channel.ts`).
- `publishWorkspaceVersion(workspaceId)`: selects the committed version (`0` when no row),
  triggers event `change` with `{ version }` on the workspace channel. Every error is caught
  and logged with `console.error`, never thrown; polling covers the gap.

### `emitChange` / `emitChangeFor` (`src/server/changes/service.ts`)

After the existing upsert, call `schedulePublish(workspaceId)`:

- No-op when `pusherConfigured()` is false.
- Dedupes per workspace per request where a request-scoped store exists (a `Set` from React
  `cache`), so a bulk update sends one event and account deletion one per workspace. Never a
  module-level set: two concurrent requests sharing one pending publish could send before the
  second one commits. Where no request scope dedupes, duplicates are sent; they carry the same
  committed version and clients ignore them, so dedupe only saves messages.
- Calls `after(() => publishWorkspaceVersion(id))`. Outside a request scope (vitest, scripts)
  `after` throws; then it falls back to `void publishWorkspaceVersion(id)` after a microtask.
  Tests run with Pusher unconfigured, so this path matters only for scripts.

All callers keep their signatures. Server actions, the REST API routes, the reminders cron
route and account deletion all run inside a request, so `after` works there.

### `POST /api/pusher/auth` (new route)

Called by `pusher-js` with form fields `socket_id` and `channel_name`.

- Pusher unconfigured → 404.
- No better-auth session → 401.
- `channel_name` not `private-workspace-<id>` or `socket_id` malformed → 403.
- Caller not a member of that workspace → 403 (same answer as an unknown id).
- Otherwise `200` with `pusher.authorizeChannel(socket_id, channel_name)`.
- `Cache-Control: private, no-store` on every answer.

## Client

### Layout

`[workspaceSlug]/layout.tsx` passes `workspaceId={ctx.workspaceId}` to `LiveRefresh` too;
the channel uses the id so a slug rename does not break it.

### Polling transport (`src/lib/live/transport.ts`)

`createPollingTransport` returns a transport whose handle also exposes `setMode(mode)`:

- `fast` (default): today's cadence (30 s, 2 min after 5 min idle).
- `safety`: 5 min regardless of idle.
- Focus and becoming visible still check at once in both modes; 401/404 still stops it.
- `setMode` reschedules the pending timer; switching to `fast` from `safety` does not fire an
  immediate check by itself.
- `checkNow()` triggers a check (used after a Pusher reconnect).

### Pusher transport (`src/lib/live/pusher-transport.ts`, new)

- Dynamically imports `pusher-js` so it stays out of the initial bundle.
- `new Pusher(key, { cluster, channelAuthorization: { endpoint: '/api/pusher/auth', transport: 'ajax' } })`,
  subscribes the workspace channel, binds `change` → `onVersion(version)` (non-number payloads
  ignored).
- Reports health to its owner: `healthy` once connected *and* `pusher:subscription_succeeded`;
  `unhealthy` on connection states `unavailable`, `failed`, `disconnected`, on `error`
  (e.g. code 4001 invalid key) and on `pusher:subscription_error`.
- `subscription_error` with status 401 or 403 (signed out, removed from workspace) → stop
  Pusher for good; polling's own 401/404 handling stops the rest.
- Unsubscribe disconnects the socket.

### Combined transport (`createLiveTransport`, `src/lib/live/live-transport.ts`, new)

The single `ChangeTransport` `LiveRefresh` uses.

- No Pusher config from the layout → polling in `fast` mode only (today).
- Otherwise starts polling in `fast` mode and Pusher together. `healthy` → polling `safety`;
  `unhealthy` → polling `fast` (one `console.warn` per fall-back, not per retry). Pusher keeps
  reconnecting on its own; on returning to `healthy` after being unhealthy, call
  `checkNow()` to pick up events missed while disconnected.
- Pusher `change` events are coalesced for 500 ms after the first one (a steady stream still lands every 500 ms), keeping the highest version before
  reaching `onVersion`. Poll answers are not debounced.
- Hidden tabs keep the socket open; refresh decisions are unchanged.

`LiveRefresh` swaps `createPollingTransport(slug)` for
`createLiveTransport({ slug, workspaceId })`. The refresher, busy detection, echo hold and the
Todo-page opt-out are unchanged.

## Failure matrix

| failure | what clients do |
|---|---|
| env vars missing | 30 s polling (today) |
| invalid key | `error` 4001 / `failed` → 30 s polling |
| invalid secret or app id | auth signature rejected → `subscription_error` → 30 s polling; publishes fail and are logged |
| Pusher outage / websocket blocked | `unavailable` → 30 s polling until it reconnects |
| one publish lost, socket healthy | safety poll within 5 min, or the next focus |
| signed out / removed | auth 401/403 stops Pusher; poll 401/404 stops polling |

## Limits

One channel per workspace, at most one event per workspace per mutating request, payload
`{ version }`. The free tier (200k messages/day, 100 concurrent connections) is enough for now.

## Testing

Vitest:

- Combined transport with a fake Pusher: unconfigured → fast polling only; healthy → safety;
  `unavailable`/`failed`/4001/`subscription_error` → fast; recovery → safety + `checkNow`;
  auth 401/403 stops Pusher; debounce keeps the highest version; unsubscribe tears down both.
- Polling `setMode` / `checkNow` timing with fake timers.
- `publishWorkspaceVersion`: reads the committed value, swallows SDK errors, no-op when
  unconfigured.
- `schedulePublish`: one publish per workspace per request; a rolled-back transaction
  publishes the unchanged version.
- Auth route: 404 unconfigured, 401 no session, 403 bad channel name, 403 non-member,
  200 member (signature from the SDK).

E2E: suite runs without Pusher env; existing live-refresh specs stay as they are.

Manual smoke with the dev Pusher app: two browsers, a change shows in ~1 s; break
`PUSHER_KEY` → falls back to 30 s polling; break `PUSHER_SECRET` → same.

## Deploy notes (for the PR)

- Set the four env vars in Vercel per environment.
- No DB migration.
- Client events and presence channels are not used.
