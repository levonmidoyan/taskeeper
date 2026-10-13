# Pusher Live Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pusher Channels carries workspace change notices in ~1 s; polling stays as the fallback (30 s when Pusher is unhealthy or unconfigured) and as a 5 min safety net while it is healthy.

**Architecture:** Server: `emitChange`/`emitChangeFor` keep bumping `workspace_change` and additionally schedule, via Next's `after()`, a publish of the *committed* counter on `private-workspace-<id>`. A new `POST /api/pusher/auth` signs private channels for members. Client: the polling transport gains `fast`/`safety` modes and `checkNow()`; a new Pusher transport reports health; a combined live transport drives polling's mode from Pusher's health and is what `LiveRefresh` subscribes to. The refresher, busy detection and echo hold are untouched.

**Tech Stack:** Next 16.3.5 (App Router, `after` from `next/server`), React 19.3, Drizzle + Postgres, `pusher` 5.3.x (server SDK), `pusher-js` 8.6.x (client, ships its own types), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-07-pusher-live-refresh-design.md`

## Global Constraints

- Server env: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`. Pusher is on only when all four are non-empty. **Plan decision (changes the spec's `NEXT_PUBLIC_*` names):** the key and cluster reach the browser as a prop from the workspace layout, read at request time, so there is no build-time inlining and the client never uses Pusher when the server cannot sign. Task 1 updates the spec table.
- Channel `private-workspace-<workspaceId>`, event `change`, payload `{ version: number }`.
- Polling cadences: `fast` = 30 s, 2 min after 5 min without input (today); `safety` = 5 min. Focus/visible checks at once in both modes. Poll 401/404 still stops polling for good.
- Pusher events coalesced for 500 ms after the first one, forwarding the highest version.
- Publishing never throws into a mutation; failures are `console.error`'d.
- Tests (vitest) and e2e never talk to Pusher: `tests/setup/env.ts` deletes the four vars; `playwright.config.ts` sets them to `''`.
- No DB migration. No version bump. Commits without any `Co-Authored-By` line.
- Branch: `feat/v2-updates`.

## Review Focus

1. **Rolled-back write publishes nothing new** — a failed mutation must not send a version that never committed (Task 1 test "a rolled-back write re-sends the committed version").
2. **Missed events while the socket was down or before it first subscribed** — on every return to healthy, poll once (Task 4 test "polls once on every return to healthy").
3. **Removed member / signed-out user keeps a live socket** — auth 401/403 must stop Pusher, and the next poll's 401/404 stops polling (Task 3 test "subscription_error 401/403 stops for good"; Task 2 test "403 for a non-member").
4. **Forged channel names** — `private-workspace-<someone else's id>`, presence/other prefixes, junk socket ids must 403 without a membership read leaking anything (Task 2 tests).
5. **Unmount races** — leaving a page before `pusher-js` finishes loading must not leave a socket open or report health afterwards (Task 3 test "unsubscribe before the client loads").

---

## File Structure

| file | status | responsibility |
|---|---|---|
| `src/lib/live/channel.ts` | create | client-safe channel/event names, `PusherClientConfig` type, channel parsing |
| `src/server/changes/pusher.ts` | create | env → config, cached `pusher` server client |
| `src/server/changes/publish.ts` | create | `publishWorkspaceVersion`, `schedulePublish` (`after`, per-request dedupe) |
| `src/server/changes/service.ts` | modify | `emitChangeFor` calls `schedulePublish` |
| `src/server/changes/queries.ts` | modify | add `isWorkspaceMember` |
| `src/app/api/pusher/auth/route.ts` | create | private-channel auth |
| `src/lib/live/transport.ts` | modify | polling `fast`/`safety` modes, `checkNow` |
| `src/lib/live/pusher-transport.ts` | create | pusher-js subscription + health |
| `src/lib/live/live-transport.ts` | create | combines polling + Pusher, debounce |
| `src/components/shell/LiveRefresh.tsx` | modify | uses `createLiveTransport` |
| `src/app/(app)/[workspaceSlug]/layout.tsx` | modify | passes `workspaceId` + `pusher` |
| `tests/setup/env.ts`, `playwright.config.ts`, `.env.example` | modify | env handling |
| `tests/server/changes-publish.test.ts` | create | publish + schedule against the test DB |
| `tests/unit/pusher-auth-route.test.ts` | create | auth route + channel parsing |
| `tests/unit/live-transport.test.ts` | modify | polling modes |
| `tests/unit/live-pusher-transport.test.ts` | create | Pusher transport with a fake client |
| `tests/unit/live-combined-transport.test.ts` | create | combined transport |

---

### Task 1: Server publish after commit

**Files:**
- Create: `src/lib/live/channel.ts`, `src/server/changes/pusher.ts`, `src/server/changes/publish.ts`, `tests/server/changes-publish.test.ts`
- Modify: `src/server/changes/service.ts`, `tests/setup/env.ts`, `playwright.config.ts`, `.env.example`, `docs/superpowers/specs/2026-10-07-pusher-live-refresh-design.md`, `package.json` (dependency)

**Interfaces:**
- Produces:
  - `src/lib/live/channel.ts`: `CHANGE_EVENT = 'change'`; `type PusherClientConfig = { key: string; cluster: string }`; `workspaceChannel(workspaceId: string): string`; `parseWorkspaceChannel(name: string): string | null`.
  - `src/server/changes/pusher.ts`: `pusherClientConfig(): PusherClientConfig | null`; `pusherServer(): Pusher | null`.
  - `src/server/changes/publish.ts`: `publishWorkspaceVersion(workspaceId: string): Promise<void>`; `schedulePublish(workspaceId: string): void`.

- [ ] **Step 1: Install the server SDK**

Run: `yarn add pusher@5.3.4`
Expected: `package.json` dependencies gain `"pusher": "5.3.4"` (exact pin, like the other deps).

- [ ] **Step 2: Keep tests and e2e off Pusher**

In `tests/setup/env.ts`, after the `delete process.env.SMTP_HOST;` line add:

```ts
// Tests must never publish to a real Pusher app; without these, live refresh
// is polling only (see src/server/changes/pusher.ts).
for (const name of ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER']) {
  delete process.env[name];
}
```

In `playwright.config.ts`, inside `webServer.env` after `CRON_SECRET`, add:

```ts
      // Live refresh runs on polling in e2e, never against a real Pusher app.
      PUSHER_APP_ID: '',
      PUSHER_KEY: '',
      PUSHER_SECRET: '',
      PUSHER_CLUSTER: '',
```

In `.env.example`, after the S3 block, add:

```
# Live refresh over Pusher Channels (https://dashboard.pusher.com, one app per
# environment). Leave any of these empty to use polling only. The key and
# cluster are public: the workspace layout hands them to the browser.
PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=
```

- [ ] **Step 3: Update the spec's env table**

In `docs/superpowers/specs/2026-10-07-pusher-live-refresh-design.md`, replace the Configuration table and the two sentences after it with:

```markdown
| var | notes |
|---|---|
| `PUSHER_APP_ID` | |
| `PUSHER_KEY` | public; the workspace layout passes it to the browser |
| `PUSHER_SECRET` | |
| `PUSHER_CLUSTER` | e.g. `eu`; passed to the browser with the key |

Pusher is on only when all four are set, on server and client alike: the layout reads them at
request time and gives `LiveRefresh` `{ key, cluster }` or `null`. No `NEXT_PUBLIC_*` vars, so
nothing is inlined at build time. Added to `.env.example`. No DB migration.
```

Also in that spec, replace `No NEXT_PUBLIC_PUSHER_KEY/cluster` under "Combined transport" with `No Pusher config from the layout`, replace "break `NEXT_PUBLIC_PUSHER_KEY`" in Testing with "break `PUSHER_KEY`", and replace "debounced 500 ms (trailing, keeping the highest version)" with "coalesced for 500 ms after the first one (a steady stream still lands every 500 ms), keeping the highest version".

- [ ] **Step 4: Write the failing test**

Create `tests/server/changes-publish.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trigger = vi.fn(async () => ({}));
vi.mock('pusher', () => ({
  default: class {
    trigger = trigger;
  },
}));

// Captures after() callbacks so a test can run them "after the response".
const afterCallbacks: Array<() => unknown> = [];
let outsideRequest = false;
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    if (outsideRequest) throw new Error('`after` was called outside a request scope.');
    afterCallbacks.push(callback);
  }),
}));

const { closeDb, db, resetDb } = await import('../setup/db');
const { createUser, createWorkspace } = await import('../setup/factories');
const { emitChangeFor } = await import('@/server/changes/service');
const { publishWorkspaceVersion, schedulePublish } = await import('@/server/changes/publish');
const { after } = await import('next/server');

const PUSHER_ENV = { PUSHER_APP_ID: '1', PUSHER_KEY: 'key', PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'eu' };

async function runAfter() {
  for (const callback of afterCallbacks.splice(0)) await callback();
}

async function workspace() {
  const ada = await createUser('ada@example.com', 'Ada');
  return createWorkspace(ada.id, 'Acme', 'acme');
}

beforeEach(async () => {
  await resetDb();
  Object.assign(process.env, PUSHER_ENV);
  outsideRequest = false;
  afterCallbacks.length = 0;
});
afterEach(() => {
  for (const name of Object.keys(PUSHER_ENV)) delete process.env[name];
  vi.clearAllMocks();
});
afterAll(closeDb);

describe('schedulePublish via emitChangeFor', () => {
  it('publishes the committed version after the response', async () => {
    const ws = await workspace();
    await db.transaction((tx) => emitChangeFor(ws.id, tx));
    expect(trigger).not.toHaveBeenCalled();
    await runAfter();
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('a rolled-back write re-sends the committed version, never the rolled-back one', async () => {
    const ws = await workspace();
    await emitChangeFor(ws.id, db);
    await runAfter();
    trigger.mockClear();

    await expect(
      db.transaction(async (tx) => {
        await emitChangeFor(ws.id, tx);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await runAfter();
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 1 });
  });

  it('does nothing when Pusher is not configured', async () => {
    delete process.env.PUSHER_SECRET;
    const ws = await workspace();
    await emitChangeFor(ws.id, db);
    expect(after).not.toHaveBeenCalled();
    await runAfter();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('outside a request scope it publishes straight away instead of throwing', async () => {
    const ws = await workspace();
    outsideRequest = true;
    schedulePublish(ws.id);
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(1));
  });

  it('does not dedupe outside a request: each call schedules its own publish', async () => {
    // React cache only dedupes inside a request; vitest has none, so this pins
    // that the dedupe store is never module-wide.
    const ws = await workspace();
    schedulePublish(ws.id);
    schedulePublish(ws.id);
    expect(after).toHaveBeenCalledTimes(2);
  });
});

describe('publishWorkspaceVersion', () => {
  it('sends 0 for a workspace that never changed', async () => {
    const ws = await workspace();
    await publishWorkspaceVersion(ws.id);
    expect(trigger).toHaveBeenCalledWith(`private-workspace-${ws.id}`, 'change', { version: 0 });
  });

  it('logs and swallows a Pusher failure', async () => {
    const ws = await workspace();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    trigger.mockRejectedValueOnce(new Error('401 invalid signature'));
    await expect(publishWorkspaceVersion(ws.id)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `yarn vitest run tests/server/changes-publish.test.ts`
Expected: FAIL — cannot resolve `@/server/changes/publish`.

- [ ] **Step 6: Implement `channel.ts`**

Create `src/lib/live/channel.ts`:

```ts
/**
 * Names shared by the server publish, the auth route and the browser. No server
 * imports: LiveRefresh bundles this.
 */
export const CHANGE_EVENT = 'change';

const PREFIX = 'private-workspace-';

/** What the workspace layout hands LiveRefresh when Pusher is configured. */
export type PusherClientConfig = { key: string; cluster: string };

export function workspaceChannel(workspaceId: string): string {
  return PREFIX + workspaceId;
}

/** The workspace id in a channel name, or null for anything else. */
export function parseWorkspaceChannel(name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const id = name.slice(PREFIX.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
```

- [ ] **Step 7: Implement `pusher.ts`**

Create `src/server/changes/pusher.ts`:

```ts
import Pusher from 'pusher';
import type { PusherClientConfig } from '@/lib/live/channel';

type PusherEnv = { appId: string; key: string; secret: string; cluster: string };

/** Read per call, not at import, so tests can switch Pusher on and off. */
function pusherEnv(): PusherEnv | null {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return null;
  return { appId, key, secret, cluster };
}

/** The public half, for the browser. null = live refresh polls only. */
export function pusherClientConfig(): PusherClientConfig | null {
  const env = pusherEnv();
  return env ? { key: env.key, cluster: env.cluster } : null;
}

let cached: { signature: string; client: Pusher } | null = null;

export function pusherServer(): Pusher | null {
  const env = pusherEnv();
  if (!env) return null;
  const signature = [env.appId, env.key, env.secret, env.cluster].join('|');
  if (cached?.signature === signature) return cached.client;
  const client = new Pusher({ ...env, useTLS: true });
  cached = { signature, client };
  return client;
}
```

- [ ] **Step 8: Implement `publish.ts`**

Create `src/server/changes/publish.ts`:

```ts
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { cache } from 'react';
import { db, workspaceChange } from '@/db';
import { CHANGE_EVENT, workspaceChannel } from '@/lib/live/channel';
import { pusherServer } from '@/server/changes/pusher';

/**
 * Sends the workspace's committed change counter to its channel. Read here,
 * after the response, not taken from the mutation: after() runs even when the
 * transaction rolled back, and a version that never committed would make
 * clients ignore the real one. Never throws; polling covers a lost publish.
 */
export async function publishWorkspaceVersion(workspaceId: string): Promise<void> {
  const server = pusherServer();
  if (!server) return;
  try {
    const [row] = await db
      .select({ version: workspaceChange.version })
      .from(workspaceChange)
      .where(eq(workspaceChange.workspaceId, workspaceId))
      .limit(1);
    await server.trigger(workspaceChannel(workspaceId), CHANGE_EVENT, { version: row?.version ?? 0 });
  } catch (error) {
    console.error('Live refresh: Pusher publish failed', error);
  }
}

// One set per request (React cache), never module-wide: a pending publish
// shared by two requests could go out before the second one commits.
const pendingForRequest = cache(() => new Set<string>());

/** Queues one publish per workspace for after this request's response. */
export function schedulePublish(workspaceId: string): void {
  if (!pusherServer()) return;
  const pending = pendingForRequest();
  if (pending.has(workspaceId)) return;
  pending.add(workspaceId);
  try {
    after(() => publishWorkspaceVersion(workspaceId));
  } catch {
    // No request (a script): best effort now; the safety poll covers a miss.
    void publishWorkspaceVersion(workspaceId);
  }
}
```

- [ ] **Step 9: Hook it into `emitChangeFor`**

In `src/server/changes/service.ts`, add the import `import { schedulePublish } from '@/server/changes/publish';`, then change `emitChangeFor` to:

```ts
/** Bumps the workspace counter for callers that have no WorkspaceContext. */
export async function emitChangeFor(workspaceId: string, tx: Executor): Promise<void> {
  await tx
    .insert(workspaceChange)
    .values({ workspaceId, version: 1 })
    .onConflictDoUpdate({
      target: workspaceChange.workspaceId,
      set: { version: sql`${workspaceChange.version} + 1`, changedAt: sql`now()` },
    });
  schedulePublish(workspaceId);
}
```

Update the `ChangeScope` comment to `No projectId = anything in the workspace may have changed. Unused for now: Pusher publishes workspace-wide (see publish.ts).` and the `emitChange` doc's last sentence to `Pusher publishes the committed counter after the response (schedulePublish).`

- [ ] **Step 10: Run the tests**

Run: `yarn vitest run tests/server/changes-publish.test.ts tests/server/changes.test.ts`
Expected: PASS. If the "does not dedupe outside a request" test fails with `after` called once, React's `cache` is caching module-wide in this environment — stop and report it; do not switch to a module-level set.

- [ ] **Step 11: Commit**

```bash
git add package.json yarn.lock src/lib/live/channel.ts src/server/changes tests/server/changes-publish.test.ts tests/setup/env.ts playwright.config.ts .env.example docs/superpowers/specs/2026-10-07-pusher-live-refresh-design.md
git commit -m "feat(live): publish the committed change counter to Pusher after each response"
```

---

### Task 2: Private channel auth route

**Files:**
- Create: `src/app/api/pusher/auth/route.ts`, `tests/unit/pusher-auth-route.test.ts`
- Modify: `src/server/changes/queries.ts`

**Interfaces:**
- Consumes: `parseWorkspaceChannel` (Task 1), `pusherServer` (Task 1).
- Produces: `isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean>` in `src/server/changes/queries.ts`; `POST /api/pusher/auth` taking form fields `socket_id`, `channel_name`, answering `{ auth: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pusher-auth-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/server/changes/queries', () => ({ isWorkspaceMember: vi.fn() }));

const { POST } = await import('@/app/api/pusher/auth/route');
const { auth } = await import('@/lib/auth');
const { isWorkspaceMember } = await import('@/server/changes/queries');
const { parseWorkspaceChannel, workspaceChannel } = await import('@/lib/live/channel');

const getSession = vi.mocked(auth.api.getSession);
const member = vi.mocked(isWorkspaceMember);

const PUSHER_ENV = { PUSHER_APP_ID: '1', PUSHER_KEY: 'key', PUSHER_SECRET: 'secret', PUSHER_CLUSTER: 'eu' };

beforeEach(() => Object.assign(process.env, PUSHER_ENV));
afterEach(() => {
  for (const name of Object.keys(PUSHER_ENV)) delete process.env[name];
  vi.clearAllMocks();
});

const call = (socketId = '123.456', channel = 'private-workspace-w1') =>
  POST(
    new Request('http://localhost/api/pusher/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ socket_id: socketId, channel_name: channel }).toString(),
    }),
  );

describe('POST /api/pusher/auth', () => {
  it('404s when Pusher is not configured', async () => {
    delete process.env.PUSHER_KEY;
    const res = await call();
    expect(res.status).toBe(404);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getSession.mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    ['another prefix', '123.456', 'presence-workspace-w1'],
    ['a public channel', '123.456', 'workspace-w1'],
    ['an id with junk', '123.456', 'private-workspace-w1;x'],
    ['an empty id', '123.456', 'private-workspace-'],
    ['a malformed socket id', 'abc', 'private-workspace-w1'],
  ])('403s for %s without reading membership', async (_label, socketId, channel) => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    const res = await call(socketId, channel);
    expect(res.status).toBe(403);
    expect(member).not.toHaveBeenCalled();
  });

  it('403s for a non-member', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    member.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(member).toHaveBeenCalledWith('u1', 'w1');
  });

  it('signs the channel for a member, never cached', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } } as never);
    member.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: string };
    expect(body.auth).toMatch(/^key:[0-9a-f]{64}$/);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('workspace channel names', () => {
  it('round-trip', () => {
    expect(parseWorkspaceChannel(workspaceChannel('Ab_9-x'))).toBe('Ab_9-x');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run tests/unit/pusher-auth-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/pusher/auth/route`.

- [ ] **Step 3: Add `isWorkspaceMember`**

Append to `src/server/changes/queries.ts`:

```ts
/** For the Pusher auth route: may this user listen to this workspace's channel? */
export async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  return Boolean(row);
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/pusher/auth/route.ts`:

```ts
import { auth } from '@/lib/auth';
import { parseWorkspaceChannel } from '@/lib/live/channel';
import { pusherServer } from '@/server/changes/pusher';
import { isWorkspaceMember } from '@/server/changes/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const SOCKET_ID = /^\d+\.\d+$/;

/**
 * pusher-js asks here before joining a workspace's private channel
 * (src/lib/live/pusher-transport.ts). Members only; a non-member, an unknown
 * workspace and a channel that is not a workspace channel all get 403.
 */
export async function POST(request: Request) {
  const server = pusherServer();
  if (!server) return new Response('Not found', { status: 404, headers: NO_STORE });

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401, headers: NO_STORE });

  const form = new URLSearchParams(await request.text());
  const socketId = form.get('socket_id') ?? '';
  const channel = form.get('channel_name') ?? '';
  const workspaceId = parseWorkspaceChannel(channel);
  if (!SOCKET_ID.test(socketId) || !workspaceId || !(await isWorkspaceMember(session.user.id, workspaceId))) {
    return new Response('Forbidden', { status: 403, headers: NO_STORE });
  }

  return Response.json(server.authorizeChannel(socketId, channel), { headers: NO_STORE });
}
```

- [ ] **Step 5: Add a DB test for `isWorkspaceMember`**

In `tests/server/changes.test.ts`, add `isWorkspaceMember` to the `@/server/changes/queries` import, and after the `describe('pollWorkspaceVersion', …)` block add:

```ts
describe('isWorkspaceMember', () => {
  it('true for a member, false for an outsider and an unknown workspace', async () => {
    const { ws, ada } = await setup();
    const eve = await createUser('eve@example.com', 'Eve');
    expect(await isWorkspaceMember(ada.id, ws.id)).toBe(true);
    expect(await isWorkspaceMember(eve.id, ws.id)).toBe(false);
    expect(await isWorkspaceMember(ada.id, 'nope')).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `yarn vitest run tests/unit/pusher-auth-route.test.ts tests/server/changes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/pusher src/server/changes/queries.ts tests/unit/pusher-auth-route.test.ts tests/server/changes.test.ts
git commit -m "feat(live): sign workspace channels for members"
```

---

### Task 3: Polling modes and the Pusher client transport

**Files:**
- Modify: `src/lib/live/transport.ts`, `tests/unit/live-transport.test.ts`
- Create: `src/lib/live/pusher-transport.ts`, `tests/unit/live-pusher-transport.test.ts`
- Modify: `package.json` (dependency)

**Interfaces:**
- Consumes: `CHANGE_EVENT`, `workspaceChannel` (Task 1).
- Produces:
  - `transport.ts`: `type PollMode = 'fast' | 'safety'`; `type PollingTransport = ChangeTransport & { setMode(mode: PollMode): void; checkNow(): void }`; `createPollingTransport(slug, options?): PollingTransport`; `PollingOptions` gains `safetyIntervalMs?: number` (default 300 000).
  - `pusher-transport.ts`: `PUSHER_AUTH_ENDPOINT = '/api/pusher/auth'`; `type PusherHealth = 'healthy' | 'unhealthy' | 'stopped'`; `type PusherLike`, `type PusherConnect = (key: string, cluster: string) => Promise<PusherLike>`; `createPusherTransport(options: { workspaceId: string; key: string; cluster: string; onHealth(health: PusherHealth): void; connect?: PusherConnect }): ChangeTransport`.

- [ ] **Step 1: Install the client SDK**

Run: `yarn add pusher-js@8.6.0`
Expected: `"pusher-js": "8.6.0"` in dependencies.

- [ ] **Step 2: Write failing polling-mode tests**

Append inside the `describe('createPollingTransport', …)` block of `tests/unit/live-transport.test.ts`, and change the `start` helper so it returns the transport too:

```ts
function start(onVersion = vi.fn()) {
  const transport = createPollingTransport('acme', {
    fetch: fetchMock as never, doc: doc as never, win: win as never,
  });
  const stop = transport.subscribe(onVersion);
  return { onVersion, stop, transport };
}
```

```ts
  it('safety mode polls every 5 min, idle or not', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    await vi.advanceTimersByTimeAsync(299_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('back to fast mode restarts the 30 s timer without checking at once', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    await vi.advanceTimersByTimeAsync(100_000);
    transport.setMode('fast');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('focus still checks at once in safety mode', async () => {
    const { stop, transport } = start();
    transport.setMode('safety');
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('checkNow checks at once, and is a no-op once unsubscribed', async () => {
    const { stop, transport } = start();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checkNow is a no-op after a 401 stopped it', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const { transport } = start();
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    transport.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `yarn vitest run tests/unit/live-transport.test.ts`
Expected: FAIL — `transport.setMode is not a function`.

- [ ] **Step 4: Implement polling modes**

In `src/lib/live/transport.ts`:

Replace the top comment of `ChangeTransport` with `/** Where change notices come from: polling, Pusher, or both (live-transport.ts). */`.

Add after `ChangeTransport`:

```ts
/** fast: today's cadence. safety: slow net while Pusher carries changes. */
export type PollMode = 'fast' | 'safety';

export type PollingTransport = ChangeTransport & {
  setMode(mode: PollMode): void;
  /** Checks at once (after Pusher reconnects). No-op while not subscribed. */
  checkNow(): void;
};
```

Add `safetyIntervalMs?: number;` to `PollingOptions`.

Update the function doc to append: `In safety mode it polls every 5 min instead, still checking at once on focus.`

Change the function to:

```ts
export function createPollingTransport(slug: string, options: PollingOptions = {}): PollingTransport {
  const {
    intervalMs = 30_000, idleAfterMs = 300_000, idleIntervalMs = 120_000, safetyIntervalMs = 300_000,
  } = options;
  let mode: PollMode = 'fast';
  let active: { schedule(): void; check(): Promise<void> } | null = null;

  return {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      active?.schedule();
    },
    checkNow() {
      void active?.check();
    },
    subscribe(onVersion) {
```

Inside `subscribe`, change `schedule` to use a delay helper:

```ts
      function delay() {
        if (mode === 'safety') return safetyIntervalMs;
        return idle() ? idleIntervalMs : intervalMs;
      }

      function schedule() {
        clearTimeout(timer);
        if (stopped || doc.visibilityState !== 'visible') return;
        timer = setTimeout(check, delay());
      }
```

Change `onInput`'s last line to `if (wasIdle && mode === 'fast') schedule();` (safety mode does not care about idle).

Register and clear `active`:

```ts
      const self = { schedule, check };
      active = self;

      function stop() {
        stopped = true;
        if (active === self) active = null;
        clearTimeout(timer);
        // …existing removeEventListener lines unchanged
      }
```

Keep everything else (`check`, listeners, `schedule()` at the end, `return stop;`) as is; close the extra `}` for the returned object.

- [ ] **Step 5: Run the polling tests**

Run: `yarn vitest run tests/unit/live-transport.test.ts`
Expected: PASS (old and new cases).

- [ ] **Step 6: Write failing Pusher transport tests**

Create `tests/unit/live-pusher-transport.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPusherTransport, type PusherHealth, type PusherLike } from '@/lib/live/pusher-transport';

type Handler = (data?: unknown) => void;

function fakePusher() {
  const connection = new Map<string, Handler>();
  const channel = new Map<string, Handler>();
  const client = {
    connection: { bind: (event: string, cb: Handler) => void connection.set(event, cb) },
    subscribe: vi.fn((_name: string) => ({ bind: (event: string, cb: Handler) => void channel.set(event, cb) })),
    disconnect: vi.fn(),
  };
  return {
    client: client as unknown as PusherLike & typeof client,
    state: (current: string) => connection.get('state_change')!({ previous: 'x', current }),
    emit: (event: string, data?: unknown) => channel.get(event)!(data),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function start(fake = fakePusher(), connect = vi.fn(async () => fake.client)) {
  const health: PusherHealth[] = [];
  const onVersion = vi.fn();
  const stop = createPusherTransport({
    workspaceId: 'w1', key: 'key', cluster: 'eu', onHealth: (h) => health.push(h), connect,
  }).subscribe(onVersion);
  await flush();
  return { fake, connect, health, onVersion, stop };
}

describe('createPusherTransport', () => {
  it('connects with the key and cluster and subscribes the workspace channel', async () => {
    const { fake, connect, stop } = await start();
    expect(connect).toHaveBeenCalledWith('key', 'eu');
    expect(fake.client.subscribe).toHaveBeenCalledWith('private-workspace-w1');
    stop();
  });

  it('is healthy only once connected and subscribed, reported once', async () => {
    const { fake, health, stop } = await start();
    fake.state('connecting');
    fake.state('connected');
    expect(health).toEqual(['unhealthy']);
    fake.emit('pusher:subscription_succeeded');
    fake.emit('pusher:subscription_succeeded');
    expect(health).toEqual(['unhealthy', 'healthy']);
    stop();
  });

  it.each(['unavailable', 'failed', 'disconnected'])('%s is unhealthy', async (state) => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_succeeded');
    fake.state(state);
    expect(health.at(-1)).toBe('unhealthy');
    stop();
  });

  it('after a reconnect waits for the new subscription before healthy again', async () => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_succeeded');
    fake.state('connecting');
    fake.state('connected');
    expect(health.at(-1)).toBe('unhealthy');
    fake.emit('pusher:subscription_succeeded');
    expect(health.at(-1)).toBe('healthy');
    stop();
  });

  it('a subscription_error with another status is unhealthy and keeps the socket', async () => {
    const { fake, health, stop } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_error', { type: 'AuthError', status: 500 });
    expect(health.at(-1)).toBe('unhealthy');
    expect(fake.client.disconnect).not.toHaveBeenCalled();
    stop();
  });

  it.each([401, 403])('subscription_error %i stops for good (signed out or removed)', async (status) => {
    const { fake, health, onVersion } = await start();
    fake.state('connected');
    fake.emit('pusher:subscription_error', { type: 'AuthError', status });
    expect(health.at(-1)).toBe('stopped');
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
    fake.emit('change', { version: 9 });
    fake.state('connected');
    expect(onVersion).not.toHaveBeenCalled();
    expect(health.at(-1)).toBe('stopped');
  });

  it('forwards numeric change versions and ignores anything else', async () => {
    const { fake, onVersion, stop } = await start();
    fake.emit('change', { version: 4 });
    fake.emit('change', { version: '5' });
    fake.emit('change', null);
    expect(onVersion.mock.calls).toEqual([[4]]);
    stop();
  });

  it('a client that fails to load is unhealthy', async () => {
    const { health } = await start(fakePusher(), vi.fn(async () => { throw new Error('chunk failed'); }));
    expect(health).toEqual(['unhealthy']);
  });

  it('unsubscribe before the client loads disconnects the late client and reports nothing', async () => {
    const fake = fakePusher();
    let resolve!: (client: PusherLike) => void;
    const health: PusherHealth[] = [];
    const stop = createPusherTransport({
      workspaceId: 'w1', key: 'key', cluster: 'eu', onHealth: (h) => health.push(h),
      connect: () => new Promise((r) => { resolve = r; }),
    }).subscribe(vi.fn());
    stop();
    resolve(fake.client);
    await flush();
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.client.subscribe).not.toHaveBeenCalled();
    expect(health).toEqual([]);
  });

  it('unsubscribe disconnects', async () => {
    const { fake, stop } = await start();
    stop();
    expect(fake.client.disconnect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `yarn vitest run tests/unit/live-pusher-transport.test.ts`
Expected: FAIL — cannot resolve `@/lib/live/pusher-transport`.

- [ ] **Step 8: Implement the Pusher transport**

Create `src/lib/live/pusher-transport.ts`:

```ts
import { CHANGE_EVENT, workspaceChannel } from '@/lib/live/channel';
import type { ChangeTransport } from '@/lib/live/transport';

export const PUSHER_AUTH_ENDPOINT = '/api/pusher/auth';

/** healthy = connected and subscribed; stopped = auth refused, never retried. */
export type PusherHealth = 'healthy' | 'unhealthy' | 'stopped';

type Bindable = { bind(event: string, callback: (data?: unknown) => void): unknown };

/** The slice of pusher-js this uses, so tests can hand in a fake. */
export type PusherLike = {
  connection: Bindable;
  subscribe(channelName: string): Bindable;
  disconnect(): void;
};

export type PusherConnect = (key: string, cluster: string) => Promise<PusherLike>;

// Loaded on first use so pusher-js stays out of the initial bundle.
const connectPusher: PusherConnect = async (key, cluster) => {
  const { default: Pusher } = await import('pusher-js');
  return new Pusher(key, {
    cluster,
    channelAuthorization: { endpoint: PUSHER_AUTH_ENDPOINT, transport: 'ajax' },
  });
};

/**
 * Change notices from the workspace's private Pusher channel. Reports its
 * health so live-transport.ts can poll faster while it is down; pusher-js
 * reconnects on its own. Auth refused (401/403: signed out, removed) stops it.
 */
export function createPusherTransport({
  workspaceId,
  key,
  cluster,
  onHealth,
  connect = connectPusher,
}: {
  workspaceId: string;
  key: string;
  cluster: string;
  onHealth(health: PusherHealth): void;
  connect?: PusherConnect;
}): ChangeTransport {
  return {
    subscribe(onVersion) {
      let stopped = false;
      let client: PusherLike | null = null;
      let connected = false;
      let subscribed = false;
      let last: PusherHealth | null = null;

      function report(health: PusherHealth) {
        if (stopped || health === last) return;
        last = health;
        onHealth(health);
      }
      const update = () => report(connected && subscribed ? 'healthy' : 'unhealthy');

      function stop() {
        stopped = true;
        client?.disconnect();
        client = null;
      }

      connect(key, cluster).then(
        (c) => {
          if (stopped) {
            c.disconnect();
            return;
          }
          client = c;
          c.connection.bind('state_change', (data) => {
            connected = (data as { current?: string } | undefined)?.current === 'connected';
            // pusher-js subscribes again after a reconnect and says so.
            if (!connected) subscribed = false;
            update();
          });
          const channel = c.subscribe(workspaceChannel(workspaceId));
          channel.bind('pusher:subscription_succeeded', () => {
            subscribed = true;
            update();
          });
          channel.bind('pusher:subscription_error', (data) => {
            subscribed = false;
            const status = (data as { status?: number } | undefined)?.status;
            if (status === 401 || status === 403) {
              report('stopped');
              stop();
              return;
            }
            update();
          });
          channel.bind(CHANGE_EVENT, (data) => {
            const version = (data as { version?: unknown } | null | undefined)?.version;
            if (!stopped && typeof version === 'number') onVersion(version);
          });
        },
        () => report('unhealthy'),
      );

      return stop;
    },
  };
}
```

- [ ] **Step 9: Run tests and typecheck**

Run: `yarn vitest run tests/unit/live-pusher-transport.test.ts tests/unit/live-transport.test.ts && yarn typecheck`
Expected: PASS, no type errors. If `new Pusher(...)` is not assignable to `PusherLike`, the mismatch is in `bind`'s callback type: widen `Bindable.bind`'s `callback` to `(data?: any) => void` rather than casting the client.

- [ ] **Step 10: Commit**

```bash
git add package.json yarn.lock src/lib/live/transport.ts src/lib/live/pusher-transport.ts tests/unit/live-transport.test.ts tests/unit/live-pusher-transport.test.ts
git commit -m "feat(live): polling safety mode and a Pusher change transport"
```

---

### Task 4: Combined live transport

**Files:**
- Create: `src/lib/live/live-transport.ts`, `tests/unit/live-combined-transport.test.ts`

**Interfaces:**
- Consumes: `PollingTransport`, `createPollingTransport` (Task 3); `createPusherTransport`, `PusherHealth` (Task 3); `PusherClientConfig` (Task 1).
- Produces: `createLiveTransport(options: { slug: string; workspaceId: string; pusher: PusherClientConfig | null; debounceMs?: number; polling?: PollingTransport; pusherTransport?: (onHealth: (health: PusherHealth) => void) => ChangeTransport }): ChangeTransport`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/live-combined-transport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveTransport } from '@/lib/live/live-transport';
import type { PusherHealth } from '@/lib/live/pusher-transport';
import type { PollingTransport } from '@/lib/live/transport';

let stopPolling: ReturnType<typeof vi.fn>;
let polling: PollingTransport & { subscribe: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn>; checkNow: ReturnType<typeof vi.fn> };
let stopPusher: ReturnType<typeof vi.fn>;
let health: (h: PusherHealth) => void;
let pusherVersion: (v: number) => void;
let pusherTransport: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  stopPolling = vi.fn();
  polling = { subscribe: vi.fn(() => stopPolling), setMode: vi.fn(), checkNow: vi.fn() } as never;
  stopPusher = vi.fn();
  pusherTransport = vi.fn((onHealth: (h: PusherHealth) => void) => {
    health = onHealth;
    return {
      subscribe: (onVersion: (v: number) => void) => {
        pusherVersion = onVersion;
        return stopPusher;
      },
    };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(pusher: { key: string; cluster: string } | null = { key: 'key', cluster: 'eu' }) {
  const onVersion = vi.fn();
  const stop = createLiveTransport({
    slug: 'acme', workspaceId: 'w1', pusher, polling, pusherTransport: pusherTransport as never,
  }).subscribe(onVersion);
  return { onVersion, stop };
}

describe('createLiveTransport', () => {
  it('without Pusher config it is polling alone', () => {
    const { onVersion, stop } = start(null);
    expect(polling.subscribe).toHaveBeenCalledWith(onVersion);
    expect(pusherTransport).not.toHaveBeenCalled();
    stop();
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });

  it('polls fast until Pusher is healthy, then slows to the safety net', () => {
    const { stop } = start();
    expect(polling.setMode).not.toHaveBeenCalled();
    health('healthy');
    expect(polling.setMode).toHaveBeenLastCalledWith('safety');
    stop();
  });

  it('polls once on every return to healthy (events missed while down)', () => {
    const { stop } = start();
    health('healthy');
    expect(polling.checkNow).toHaveBeenCalledTimes(1);
    health('unhealthy');
    health('healthy');
    expect(polling.checkNow).toHaveBeenCalledTimes(2);
    stop();
  });

  it('falls back to fast polling and warns once per fall-back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { stop } = start();
    health('unhealthy');
    expect(warn).not.toHaveBeenCalled();
    health('healthy');
    health('unhealthy');
    expect(polling.setMode).toHaveBeenLastCalledWith('fast');
    health('unhealthy');
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stopped Pusher leaves fast polling to find out about the session', () => {
    const { stop } = start();
    health('healthy');
    health('stopped');
    expect(polling.setMode).toHaveBeenLastCalledWith('fast');
    stop();
  });

  it('coalesces Pusher events for 500 ms and forwards the highest version', async () => {
    const { onVersion, stop } = start();
    pusherVersion(4);
    pusherVersion(6);
    pusherVersion(5);
    await vi.advanceTimersByTimeAsync(499);
    expect(onVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onVersion.mock.calls).toEqual([[6]]);
    pusherVersion(7);
    await vi.advanceTimersByTimeAsync(500);
    expect(onVersion.mock.calls).toEqual([[6], [7]]);
    stop();
  });

  it('unsubscribe stops both and drops a pending event', async () => {
    const { onVersion, stop } = start();
    pusherVersion(4);
    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onVersion).not.toHaveBeenCalled();
    expect(stopPusher).toHaveBeenCalledTimes(1);
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run tests/unit/live-combined-transport.test.ts`
Expected: FAIL — cannot resolve `@/lib/live/live-transport`.

- [ ] **Step 3: Implement**

Create `src/lib/live/live-transport.ts`:

```ts
import type { PusherClientConfig } from '@/lib/live/channel';
import { createPusherTransport, type PusherHealth } from '@/lib/live/pusher-transport';
import { createPollingTransport, type ChangeTransport, type PollingTransport } from '@/lib/live/transport';

/**
 * What LiveRefresh subscribes to. Without Pusher config: polling, as before.
 * With it: Pusher carries changes and polling drops to a 5-minute safety net
 * while Pusher is healthy, back to 30 s whenever it is not (bad key or secret,
 * outage, blocked websocket). Bursts of Pusher events are coalesced.
 */
export function createLiveTransport({
  slug,
  workspaceId,
  pusher,
  debounceMs = 500,
  polling = createPollingTransport(slug),
  pusherTransport,
}: {
  slug: string;
  workspaceId: string;
  pusher: PusherClientConfig | null;
  debounceMs?: number;
  polling?: PollingTransport;
  /** Tests hand in a fake; by default the pusher-js one. */
  pusherTransport?: (onHealth: (health: PusherHealth) => void) => ChangeTransport;
}): ChangeTransport {
  return {
    subscribe(onVersion) {
      const stopPolling = polling.subscribe(onVersion);
      if (!pusher) return stopPolling;

      let healthy = false;
      function onHealth(health: PusherHealth) {
        if (health === 'healthy') {
          healthy = true;
          polling.setMode('safety');
          // Changes made while the socket was down, or before it first
          // subscribed, sent events nobody heard.
          polling.checkNow();
          return;
        }
        if (healthy) console.warn(`Live refresh: Pusher is ${health}; polling every 30 s.`);
        healthy = false;
        polling.setMode('fast');
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending = 0;
      const make =
        pusherTransport ??
        ((h: (health: PusherHealth) => void) =>
          createPusherTransport({ workspaceId, key: pusher.key, cluster: pusher.cluster, onHealth: h }));
      const stopPusher = make(onHealth).subscribe((version) => {
        pending = Math.max(pending, version);
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          const latest = pending;
          pending = 0;
          onVersion(latest);
        }, debounceMs);
      });

      return () => {
        clearTimeout(timer);
        stopPusher();
        stopPolling();
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn vitest run tests/unit/live-combined-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live/live-transport.ts tests/unit/live-combined-transport.test.ts
git commit -m "feat(live): combine Pusher and polling, with polling as the fallback"
```

---

### Task 5: Wire LiveRefresh and verify end to end

**Files:**
- Modify: `src/components/shell/LiveRefresh.tsx`, `src/app/(app)/[workspaceSlug]/layout.tsx`

**Interfaces:**
- Consumes: `createLiveTransport` (Task 4), `pusherClientConfig` (Task 1), `PusherClientConfig` (Task 1).
- Produces: `LiveRefresh` props `{ slug: string; workspaceId: string; version: number; pusher: PusherClientConfig | null }`.

- [ ] **Step 1: Update LiveRefresh**

In `src/components/shell/LiveRefresh.tsx`: replace the `createPollingTransport` import with

```ts
import type { PusherClientConfig } from '@/lib/live/channel';
import { createLiveTransport } from '@/lib/live/live-transport';
```

Change the signature and the subscribe effect:

```tsx
export function LiveRefresh({
  slug,
  workspaceId,
  version,
  pusher,
}: {
  slug: string;
  workspaceId: string;
  version: number;
  /** null = Pusher not configured: poll only. */
  pusher: PusherClientConfig | null;
}) {
```

```tsx
  // Primitives, so a re-render with an equal config object does not resubscribe.
  const pusherKey = pusher?.key;
  const pusherCluster = pusher?.cluster;

  useEffect(() => {
    if (paused) return;
    const r = createRefresher({ seen: seen.current, isBusy, refresh: () => router.refresh() });
    refresher.current = r;
    const unsubscribeBusy = subscribeBusy(r.recheck);
    const config = pusherKey && pusherCluster ? { key: pusherKey, cluster: pusherCluster } : null;
    const unsubscribeChanges = createLiveTransport({ slug, workspaceId, pusher: config }).subscribe(r.onVersion);
    return () => {
      unsubscribeChanges();
      unsubscribeBusy();
      refresher.current = null;
    };
  }, [slug, workspaceId, pusherKey, pusherCluster, paused, router]);
```

Update the component doc's first sentence to: `Keeps workspace pages current while teammates edit, over Pusher when configured and polling otherwise (src/lib/live/live-transport.ts): when the workspace's change counter passes …` (rest unchanged).

- [ ] **Step 2: Update the layout**

In `src/app/(app)/[workspaceSlug]/layout.tsx` add `import { pusherClientConfig } from '@/server/changes/pusher';` and change the element to:

```tsx
      <LiveRefresh slug={ctx.slug} workspaceId={ctx.workspaceId} version={version} pusher={pusherClientConfig()} />
```

- [ ] **Step 3: Typecheck, lint, full unit suite**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all green (previous count 873+ plus the new cases).

- [ ] **Step 4: E2E live refresh on polling**

The user's `next dev` often holds :3000 against the dev DB, so run on another port. Use a temp Playwright config at `/tmp/claude-1000/.../scratchpad/pw-3100.config.ts` that imports the repo config and overrides `use.baseURL` to `http://localhost:3100`, `webServer.url` to the same, `webServer.command` to `yarn build && yarn start -p 3100`, `reuseExistingServer: false`, and adds `BETTER_AUTH_URL: 'http://localhost:3100'` to `webServer.env`.

Run: `yarn playwright test -c <that config> tests/e2e/live-refresh.spec.ts`
Expected: all live-refresh specs pass (polling path, Pusher env blank).

- [ ] **Step 5: Manual smoke with the dev Pusher app**

With `PUSHER_*` set in `.env.local` (dev app), `yarn build && yarn start -p 3100` with `BETTER_AUTH_URL=http://localhost:3100`. In two browsers signed in as two members of one workspace on the same project board:

1. Move a card in A → B updates in about a second. DevTools Network in B: one `wss://ws-<cluster>.pusher.com` socket; `/api/workspaces/<slug>/changes` only on load/focus and every 5 min.
2. Restart with `PUSHER_KEY=wrong` → B logs nothing fatal, `/changes` polls every 30 s, a change still arrives within 30 s.
3. Restart with the right key but `PUSHER_SECRET=wrong` → `/api/pusher/auth` 200 but subscription rejected by Pusher; B falls back to 30 s polling; server logs `Live refresh: Pusher publish failed`.

Report what was observed for each; do not claim the smoke passed without running it (it needs the user's dev Pusher credentials — ask if they are not in `.env.local`).

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/LiveRefresh.tsx "src/app/(app)/[workspaceSlug]/layout.tsx"
git commit -m "feat(live): use Pusher for live refresh when configured"
```

- [ ] **Step 7: Update the knowledge graph**

Run: `graphify update .`
