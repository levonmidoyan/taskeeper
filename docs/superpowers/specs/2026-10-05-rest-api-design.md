# REST API v1 — Design

**Roadmap item:** 14a (slice 10, REST half). Mobile (14b) is out of scope here; this design
only keeps the door open for it.
**Branch:** `feat/rest-api` off `develop`, PR into `develop`.
**Date:** 2026-10-05. Approved in conversation section by section.

## 1. Goal

Let a user drive Taskeeper from scripts and integrations (n8n, Zapier, CI jobs, a CLI) with a
personal API token, over a small, documented, stable JSON API that calls the same `server/*`
functions the web app does. A later mobile app must be able to reuse every endpoint by adding
one more way to authenticate, and nothing else.

**Success:** a user creates a token in Account → API tokens, reads `/docs/api`, and with one
`curl` lists their workspaces, creates a task, moves it to Done and comments on it — with the
activity log, live refresh and permissions behaving exactly as if they had done it in the UI.

**Decisions taken:**

| Question | Decision |
|---|---|
| Consumer | Integrations first; designed so mobile can reuse it |
| Token reach | User-level: works in every workspace the user is a member of, with their role there |
| v1 surface | Core task loop (below) |
| Token mechanism | Own `api_token` table + one `apiRoute()` wrapper (not the Better Auth api-key plugin, not bearer sessions) |
| Docs | OpenAPI 3.1 JSON generated from the Zod contract + our own reference page built from Align UI atoms (no Scalar, no external script) |

**Non-goals for v1:** per-token permission scopes (a token acts with the user's full role),
CORS / browser callers, webhooks, attachments, subtasks endpoints, moving tasks across
projects, bulk operations, editing or deleting comments, project / status / label / member
management, saved views, todos, reminders, notifications.

## 2. Tokens

### 2.1 Schema

```
api_token
  id            text pk
  user_id       text not null → user.id on delete cascade
  name          text not null            -- 1..60 chars, user-chosen
  prefix        text not null            -- first 8 chars of the token, for display
  token_hash    text not null unique     -- hex SHA-256 of the full token
  last_used_at  timestamptz null
  expires_at    timestamptz null         -- null = never
  revoked_at    timestamptz null
  created_at    timestamptz not null default now()
  index (user_id)
```

- Format: `tk_` + 32 random bytes encoded base62 (≈ 43 chars). Shown to the user **once**, at
  creation; afterwards only `prefix` (`tk_aB3x…`).
- Hash: SHA-256, not bcrypt/argon2. The token is 256 bits of randomness, so a slow hash adds
  nothing; SHA-256 keeps lookup to one indexed equality query.
- Expiry options at creation: 30, 90, 365 days, or never. Default 90.
- At most **20 active** (not revoked, not expired) tokens per user; creating a 21st returns
  an error.
- `last_used_at` is updated at most once per minute per token (conditional `UPDATE … WHERE
  last_used_at IS NULL OR last_used_at < now() - interval '1 minute'`), so a busy script does
  not write on every request.
- Account deletion cascades the rows. Signing out, revoking sessions or changing the password
  does **not** touch tokens; they are revoked only from their own screen. The tokens screen
  says so.

### 2.2 Services

`src/server/api-tokens/` with `ctx: UserContext` first (account-level, like
`user-settings`):

- `listApiTokens(ctx)` → name, prefix, createdAt, lastUsedAt, expiresAt (revoked rows hidden).
- `createApiToken(ctx, { name, expiresInDays })` → `Result<{ id, token }>`; the only place the
  plaintext exists.
- `revokeApiToken(ctx, id)` → sets `revoked_at`; a token of another user is "not found".
- `authenticateApiToken(raw)` → `{ userId, tokenId } | null`. Not ctx-first: it is the
  function that produces the user. Null for malformed, unknown, revoked or expired, without
  distinguishing them.

Server Actions in `actions.ts` wrap the first three for the UI, through `withAction`.

### 2.3 UI — Account → API tokens

New tab next to Preferences: `src/app/(app)/settings/api-tokens/page.tsx`, added to
`SettingsTabs`.

- Table: name, prefix, created, last used ("Never" / relative day with exact time on hover,
  same pattern as attachment cards), expires ("Never" or date; expired rows labelled
  Expired).
- **New token** dialog: name + expiry select → on success the dialog switches to a one-time
  reveal: the token in a read-only field, a Copy button, and "You won't see this again."
- Revoke: per-row button behind the existing `useConfirm` dialog.
- A short paragraph linking to `/docs/api`, and stating that tokens keep working after
  sign-out until revoked or expired.

## 3. Request pipeline

All endpoints live under `src/app/api/v1/` as route handlers. Each handler is produced by
`apiRoute(contract, handler)` in `src/server/api/route.ts`, which runs, in order:

1. **Authenticate.** `Authorization: Bearer tk_…` (scheme case-insensitive). Missing header, wrong scheme, unknown,
   revoked or expired token → **401** `unauthorized`, one message for all cases.
   The authenticator is a list of strategies; v1 has only the token strategy. Mobile (14b)
   adds a Better Auth bearer-session strategy here and nothing below it changes.
2. **Rate limit.** 120 requests per minute per token, fixed window, counted in Postgres
   (`api_rate_limit(token_id, window_start, count)`, upsert-and-return), because serverless
   instances share no memory. Over the limit → **429** `rate_limited` with `Retry-After`
   (seconds to window end). Old windows are deleted by the existing daily cron.
3. **Resolve the workspace** (workspace routes only). `resolveWorkspace(userId, slug)`; null →
   **404** `not_found`, same as the UI: a non-member must not learn which slugs exist. The
   resulting `WorkspaceContext` is the real one, so `ctx.userId` — the token owner — is the
   actor for activity rows, change stamps and permission checks.
4. **Validate** path params, query and JSON body against the route's contract schemas.
   Failure → **400** `invalid_request` with `issues: [{ path, message }]`. A body that is
   not JSON, or a repeated query parameter → 400 too. A body over 128 KB → **413**
   `payload_too_large`, read no further than the cap.
5. **Call** the existing `server/*` function and map its result:
   - `ok` → **200** (or **201** for creates, **204** for delete) with the serialized body.
   - failure with `code: 'forbidden'` → **403** `forbidden`.
   - failure with `code: 'not_found'` → **404** `not_found`.
   - any other failure → **422** `unprocessable` with the service's message.
   - an exception → **500** `internal`, generic message, logged server-side.

Any other `/api/v1` path → **404** `not_found` in this shape (catch-all route).
Every response carries `Cache-Control: private, no-store`. Error body shape, always:

```json
{ "error": { "code": "invalid_request", "message": "…", "issues": [ … ] } }
```

### 3.1 Changes to existing code

- `Result` failure gains an optional `code?: 'forbidden' | 'not_found'`.
  `withAction` sets `forbidden` when it catches `ForbiddenError`. UI callers ignore the field.
- Task routes look the task up with `getTask(ctx, id)` before mutating; null (missing,
  another workspace's, or in an archived project) → 404. This keeps 404 vs 422 out of the
  services' message strings.
- `listWorkspaceTasks` gains an `offset` option and returns `statusId`, `assigneeId`,
  `parentTaskId` and label ids in its rows, which the API needs and the All tasks page
  ignores.
- `RESERVED_SLUGS` gains `docs` (see §5).

## 4. Endpoints

JSON, camelCase. IDs are the existing text ids. `dueDate` is `YYYY-MM-DD`; timestamps are
ISO-8601 UTC strings.

| Method + path | Service | Success |
|---|---|---|
| `GET /api/v1/me` | user row | 200 `{ id, name, email }` |
| `GET /api/v1/workspaces` | `listMyWorkspaces` | 200 `{ data: [{ slug, name, role }] }` |
| `GET /api/v1/workspaces/{slug}/projects` | `listProjects` | 200 `{ data: Project[] }` (active only) |
| `GET /api/v1/workspaces/{slug}/projects/{projectId}` | `getProject` | 200 `Project & { statuses: Status[] }` (statuses in board order) |
| `GET /api/v1/workspaces/{slug}/labels` | `listLabels` | 200 `{ data: [{ id, name, color }] }` |
| `GET /api/v1/workspaces/{slug}/members` | `listWorkspaceMembers` | 200 `{ data: [{ id, name, email, role }] }` — every member already sees emails in the UI (members page, assignee picker) |
| `GET /api/v1/workspaces/{slug}/tasks` | `listWorkspaceTasks` | 200 `{ data: TaskSummary[], nextCursor }` |
| `POST /api/v1/workspaces/{slug}/tasks` | `createTask` | 201 `Task` |
| `GET /api/v1/workspaces/{slug}/tasks/{taskId}` | `getTaskDetail` | 200 `Task` |
| `PATCH /api/v1/workspaces/{slug}/tasks/{taskId}` | `updateTask` (+ `setTaskLabels` when `labelIds` present) | 200 `Task` |
| `DELETE /api/v1/workspaces/{slug}/tasks/{taskId}` | `deleteTask` | 204 |
| `GET /api/v1/workspaces/{slug}/tasks/{taskId}/comments` | comment entries of `listTaskFeed` | 200 `{ data: Comment[] }` oldest first |
| `POST /api/v1/workspaces/{slug}/tasks/{taskId}/comments` | `createComment` | 201 `Comment` |

### 4.1 Shapes

API serializers in `src/server/api/serialize.ts` map internal rows to these; internal row
types never leave the server directly, so the UI can change its queries without breaking the
contract.

```
Project     { id, name, slug, color, openTaskCount }
Status      { id, name, isDone }                   -- array order = board order
TaskSummary { id, projectId, parentTaskId, title, status: { id, name, isDone }, priority,
              assignee: { id, name } | null, dueDate, labels: [{ id, name }],
              createdAt, updatedAt, url }
Task        TaskSummary & { description }          -- Markdown
Comment     { id, author: { id, name } | null, body, createdAt, editedAt }
```

`url` is the task's absolute link in the web app (built from `appUrl`). `priority` is one of
`none | low | medium | high | urgent`.

### 4.2 Task list query

- Filters reuse the existing URL grammar via `filterFromParams`: `state=open|done|all`
  (default `open`), `status`, `priority`, `assignee` (`me`, `none` or ids), `labels`,
  `created` (creator ids), `due` (`overdue|today|this_week|next_7d|none`), `q`; plus `projectId`.
- `sort`: `due` (default), `created`, `updated`, `priority`, `title`; `-` prefix for
  descending.
- Pagination: `limit` 1–100 (default 50) and `cursor`. The cursor is an opaque base64url
  offset; `nextCursor` is null on the last page. Offset paging can skip or repeat a row when
  tasks change between pages — acceptable for v1 and stated in the docs.

### 4.3 Writes

- `POST tasks` body: `projectId`, `title` required; `statusId`, `parentTaskId`,
  `description`, `priority`, `assigneeId`, `dueDate`, `labelIds` optional — the existing
  `createSchema`.
- `PATCH tasks/{id}` body: any of `title`, `description`, `statusId`, `priority`,
  `assigneeId`, `dueDate`, `labelIds`. Empty body → 400. Moving to a status of another
  project is rejected by the service (422).
- `POST comments` body: `{ body }` Markdown, existing limits.

## 5. Contract, OpenAPI and docs page

**Contract.** `src/server/api/contract/` declares each endpoint once: method, path, summary,
description, params / query / body Zod schemas, response schema, and the error codes it can
return. `apiRoute()` validates against these same schemas, so validation, OpenAPI and the docs
page cannot disagree.

**OpenAPI.** `GET /api/v1/openapi.json` (public, `Cache-Control: public, max-age=300`) builds
an OpenAPI 3.1 document from the registry with Zod 4's `z.toJSONSchema`. No generator
library. Security scheme: HTTP bearer.

**Docs page.** `/docs/api`, public, a server component rendered from the same registry —
our own page, Align UI atoms and the app's tokens, no external scripts:

- Intro: base URL, authentication (`Authorization: Bearer tk_…`, link to Account → API
  tokens), rate limit, error shape and codes, pagination, date formats.
- Endpoints grouped by resource (Account, Workspaces, Projects, Tasks, Comments), with a
  sticky side index on wide screens and a collapsible one on phones.
- Each endpoint: method badge, path, description, parameter table (name, in, type, required,
  description), request and response schema rendered as a nested field tree from the JSON
  Schema, a `curl` example, and its possible errors.
- A download link for `openapi.json`. No try-it-out console.

**Reserved slug.** `/docs` is a static segment, which Next resolves before the dynamic
`[workspaceSlug]`, so a workspace with slug `docs` would become unreachable. `docs` joins
`RESERVED_SLUGS`, and the PR notes that before deploying, prod must be checked for an
existing `docs` workspace (`select slug from organization where slug = 'docs'`); if one
exists it is renamed first.

## 6. Testing

TDD, real database, same setup as the existing server tests.

- `tests/server/api-tokens.test.ts`: create returns the plaintext once and stores only the
  hash; prefix; expiry; 20-token cap; revoke; another user's token is not found;
  `authenticateApiToken` rejects malformed / unknown / revoked / expired; `last_used_at`
  throttle; cascade on account deletion.
- `tests/server/api-rate-limit.test.ts`: counting within a window, 429 with `Retry-After`,
  reset at the next window.
- `tests/server/api-v1-*.test.ts`, calling route handlers with real rows:
  - 401 for missing, malformed, revoked and expired tokens, one identical body.
  - 404 for a non-member slug, another workspace's task, a task in an archived project.
  - 403 where the UI forbids the same action for that role.
  - 400 for bad bodies and query params, with `issues`.
  - task list filters, sort, pagination and `nextCursor`.
  - create / update / delete / comment write activity rows and bump the workspace change
    stamp with the token owner as actor.
- `tests/unit/openapi.test.ts`: every route under `src/app/api/v1` is in the registry, and
  the generated document is valid OpenAPI 3.1 (structure check of required fields, paths,
  operationIds unique).
- e2e `tests/e2e/api-tokens.spec.ts`: create a token in Account → API tokens, copy it, create
  a task through `fetch` with it, see the task in the List, revoke, get 401; `/docs/api`
  renders and lists the task endpoints.
- `api_token` and `api_rate_limit` join the `TRUNCATE` list in `tests/setup/db.ts`.

## 7. Rollout

- PR into `develop`. PR body: run `yarn db:setup:prod` **before** deploying (new tables), and
  check for a `docs` workspace slug (§5). No new environment variables.
- Roadmap doc: item 14 splits into **14a REST API v1** (this spec) and **14b mobile**:
  enable Better Auth's `bearer` plugin, add the session strategy to the authenticator, and
  sign in through the existing device-authorization flow — designed when a mobile app is
  real.
