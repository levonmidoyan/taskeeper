# Comment reactions — design

Builds on the task comments (`src/server/comments/`), the live refresh (`emitChange`) and
`2026-10-07-change-notifications-design.md` (bell + toast via `notifyTaskChange`).
Any member can react to a comment with one of a fixed set of emoji; the comment's author
hears about it.

## Goal

- One click to react to a comment, one click to take it back.
- Reaction counts, my own reactions and who reacted are visible on every comment.
- Teammates see reactions arrive through the existing live refresh.
- The comment's author gets a bell item (and toast) when someone else reacts.

## Decisions (user, 2026-10-08)

- **Emoji set:** fixed, six: 👍 ❤️ 🎉 😄 👀 🚀. No picker library, no free-form emoji.
- **Notifications:** comment author only, through the change-notification path. Only an
  added reaction notifies; removing one does not. Reacting to your own comment never notifies.
- **REST API:** read-only. Reactions appear in the comment shape; no write endpoint.
- **Storage:** separate `comment_reaction` table (not a jsonb column on `comment`): no
  read-modify-write race on concurrent toggles, uniqueness enforced by the key, rows
  cascade with the user and the comment.
- **Branch:** `feat/v2-updates`.

## Data

### `comment_reaction` (src/db/schema/activity.ts)

| column | type | notes |
| --- | --- | --- |
| `comment_id` | text | → `comment.id`, `on delete cascade` |
| `workspace_id` | text | → `organization.id`, `on delete cascade`; denormalized tenancy predicate, like `comment` |
| `user_id` | text | → `user.id`, `on delete cascade`; a deleted account's reactions vanish |
| `emoji` | text | validated in code against `REACTION_EMOJIS` |
| `created_at` | timestamptz | `default now()` |

- Primary key `(comment_id, user_id, emoji)`. One user may add several different emoji to
  the same comment; each is one row.
- `emoji` is plain text, not a pg enum, for the same reason as `task_activity.kind`: the
  list is owned by code.
- No migrations in this project: `yarn db:setup` (`drizzle-kit push`) creates the table.
  Prod needs `yarn db:setup:prod` on deploy.

### `src/lib/reactions.ts` (new, shared by server and UI)

```ts
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '👀', '🚀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export type CommentReaction = { emoji: ReactionEmoji; count: number; reactedByMe: boolean; names: string[] };
```

## Write path

### `toggleReaction(ctx, { commentId, emoji })` — `src/server/comments/reactions.ts`

Returns `Result<{ reacted: boolean }>`.

1. Zod: `commentId` non-empty, `emoji` in `REACTION_EMOJIS` → else `err('Unknown reaction.')`.
2. Load the comment scoped to `ctx.workspaceId`, inner-joined to its task and a project with
   `archived_at is null` (same gate as `createComment`). Missing → `err('Comment not found.')`.
3. One transaction:
   - `INSERT … ON CONFLICT DO NOTHING RETURNING` the row (`user_id` from `ctx`, never input).
   - No row returned → it existed: `DELETE` it; `reacted = false`.
   - Row returned → `reacted = true`; if the comment's `author_id` is set and differs from
     `ctx.userId`, call `notifyTaskChange` (below).
   - `emitChange(ctx, {}, tx)`.

Any member may react, including to their own comment.

### `toggleReactionAction(workspaceSlug, input)` — `src/server/comments/actions.ts`

Slug-taking wrapper like the others: `requireWorkspace`, call the service, revalidate the
workspace layout on success.

### Notification — `src/server/notifications/changes.ts`, `src/lib/notifications.ts`

- `TASK_CHANGE_KINDS` gains `'reaction'`; `FIELD_LABELS.reaction = 'reaction'`.
- `TaskChangeData` gains `reaction?: { emoji: string; comment: string }` (comment excerpt via
  `commentExcerpt`).
- `notifyTaskChange` input gains `recipients?: string[]`. When given, it replaces the
  assignee/creator/previous-assignee set; the `recipients()` filter (member of workspace,
  not the actor, `changeNotify` on) still applies.
- The conflict update keeps a stored `reaction` when the incoming payload lacks one
  (`keepStored('reaction')`), as it does for `comment` and `status`.
- `taskDetail`: when `reaction` is the only change →
  `${actorName} reacted ${emoji} to your comment: “${comment}”`. Mixed with other changes,
  it is listed like any other field.

## Read path

### Feed — `src/server/activity/queries.ts`

- A third query in the existing `Promise.all`: `comment_reaction` joined to `comment` (by
  `task_id` and `workspace_id`) and `user` (for `name`), ordered by `created_at`.
- Grouped in JS by comment id into `CommentReaction[]`: in `REACTION_EMOJIS` order, only
  emoji with at least one row, `names` in reaction order, `reactedByMe` against `ctx.userId`.
- Comment feed entries gain `reactions: CommentReaction[]` (empty array when none).

### REST API (read-only)

- `commentShape` (`src/server/api/contract/shapes.ts`) gains
  `reactions: z.array(z.object({ emoji: z.string(), count: z.number().int(), userIds: z.array(z.string()) }))`.
- The feed entry therefore also carries `userIds` per reaction (alongside `names`);
  `serializeComment` maps `{ emoji, count, userIds }`.
- OpenAPI output updated; no new routes.

## UI

### `CommentReactions` — `src/components/task/CommentReactions.tsx` (new)

Rendered in `ActivityFeed` under a comment's `Markdown` body; not rendered while that comment
is being edited.

- **Chips:** one pill per used emoji, `👍 3`. `reactedByMe` → primary-tinted background and
  border. Click toggles. `aria-pressed={reactedByMe}`, `aria-label="React with 👍 (3)"`.
  Tooltip lists names: "Ana", "Ana and Ben", "Ana, Ben and 2 others".
- **Add button:** ghost `CompactButton` with Tabler `IconMoodPlus`, always visible, subtle
  (`text-text-soft-400`). Opens a popover with the six emoji as buttons (`aria-label`
  "React with 👍"); picking one toggles it and closes the popover.
- **Optimistic:** `useOptimistic` over the comment's reactions; apply the toggle locally
  (count ± 1, `reactedByMe` flip, "You" added/removed from names, chip removed at 0), then
  `toggleReactionAction`, then `router.refresh()`. On error: toast the message; the
  optimistic state reverts when the transition ends.

## Testing

- **Server** `tests/server/comment-reactions.test.ts`:
  - toggle adds, second toggle removes; two different emoji coexist for one user
  - unknown emoji rejected
  - comment in another workspace → "Comment not found."
  - comment on an archived project → "Comment not found."
  - added reaction notifies the author once; repeated reactions by the same actor merge
    into one unread item
  - no notification for self-reaction, for an author with `changeNotify = false`, for a
    deleted author, or on removal
  - deleting the comment, or the reacting user, removes the reactions
  - `emitChange` bumps the workspace version
- **Server** feed: `getFeed` groups reactions in emoji order with counts, names,
  `reactedByMe`; `tests/server/api-v1-comments.test.ts` sees `reactions` in the response.
- **Unit:** notification text for `reaction` alone and mixed; OpenAPI test picks up the new
  field; `tests/server/schema.test.ts` covers the new table.
- **E2E** `tests/e2e/comments.spec.ts`: add 👍 via the popover → chip shows 1 and is pressed;
  click the chip → chip gone.

## Out of scope

- Free-form emoji / picker library.
- Reactions on tasks or activity entries.
- REST write endpoints for reactions.
- Retracting a notification when the reaction is removed.
