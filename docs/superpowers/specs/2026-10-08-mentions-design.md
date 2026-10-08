# @mentions — design

Builds on the rich-text editor (`src/components/task/RichTextField.tsx`, Markdown storage), the
slash menu (`src/components/kibo-ui/editor/slash.tsx`, `@tiptap/suggestion`) and change
notifications (`2026-10-07-change-notifications-design.md`, `src/server/notifications/changes.ts`).

Typing `@` in a comment or a task description opens a member picker; the chosen teammate shows
as a chip and gets a bell item (and toast) saying they were mentioned.

## Goal

- `@` + a few letters + Enter mentions a workspace member in a comment or description.
- A mention reads as a chip everywhere the Markdown is rendered, with the member's current name.
- The mentioned member gets a bell item + toast, even with change notifications turned off.
- Editing a comment or description notifies only people newly mentioned by that edit.

## Decisions (user, 2026-10-08)

- **Scope:** comments and task descriptions (task detail, create-task dialog). Not the private to-do page.
- **Effect:** bell + toast only. No email, no "watcher" concept.
- **Toggle:** mentions always notify; `user_settings.change_notify` does not mute them.
- **Storage:** a Markdown link with a custom scheme, `[@Display Name](mention:<userId>)`, inside
  the existing `comment.body` / `task.description`. No mention table.
- **Branch:** `feat/v2-updates`.

## Format — `src/lib/mentions.ts` (new, shared by server and UI)

- Stored form: `[@Display Name](mention:<userId>)`. The display name is the member's name at
  insert time; it is the fallback text for readers without the member list (REST API, ex-members).
- `MENTION_SCHEME = 'mention:'`.
- `extractMentionIds(markdown: string): string[]` — ids of every `mention:` link, deduped, in
  order of first occurrence. Fenced code blocks and inline code spans are stripped first, so a
  mention-shaped string inside code is not a mention. Malformed links (empty id, whitespace in id)
  are ignored.
- `mentionsToText(markdown: string): string` — replaces each mention link with `@Display Name`.
- `commentExcerpt` (`src/server/notifications/changes.ts`) runs `mentionsToText` before
  flattening, so bell excerpts read `@Ana`, not link syntax.

## Data

### `notification` (src/db/schema/reminder.ts)

- `notification_kind` enum gains `mention`.
- New partial unique index `notification_open_mention_uq` on `(user_id, task_id, actor_id)`
  `where kind = 'mention' and read_at is null` — the merge target, as for `task_change`.
- `dedupe_key` uses `mtn:<newId>`.
- `notification_unsent_idx` already excludes everything but `reminder`/`digest`; no change.

Schema goes in with `drizzle-kit push` (`yarn db:setup*`): an enum value and an index,
non-destructive. Production needs `db:setup:prod`.

### Payload (src/lib/notifications.ts)

```ts
export type MentionWhere = 'comment' | 'description';

export type MentionData = {
  title: string;          // task title at the latest merged mention
  projectName: string;
  actorName: string;
  where: MentionWhere[];  // deduped, order of first occurrence
  comment?: string;       // latest comment excerpt (≤ 120 chars), when 'comment' is in where
};
```

`NotificationData` widens with `MentionData`.

## Server

### `notifyMentions(ctx, tx, { taskId, userIds, where, comment? })` — `src/server/notifications/changes.ts`

Runs inside the caller's transaction, after the write.

1. No-op when `userIds` is empty.
2. Reads the task (post-write) with its project name, scoped to `ctx.workspaceId`.
3. Recipients = `userIds` − `ctx.userId`, filtered to current members of `ctx.workspaceId`,
   ordered by id (same deadlock rule as `recipients`). **No** `change_notify` filter.
4. Upsert per recipient: `INSERT … ON CONFLICT (user_id, task_id, actor_id) WHERE kind =
   'mention' AND read_at IS NULL DO UPDATE` with `where` = ordered union, `comment` =
   incoming when present else stored (`keepStored('comment')`), `title`/`projectName`/
   `actorName` = incoming, `created_at = clock_timestamp()`.
5. Returns the recipient ids it wrote.

### `notifyTaskChange` gains `skip?: string[]`

Recipients in `skip` are dropped. Callers pass the ids `notifyMentions` returned, so a member
who is both assignee and mentioned gets one item (the mention) for that write, not two.
`notifyMentions` therefore runs first.

### Call sites

| Write | Mentioned ids notified | `where` |
|---|---|---|
| `createComment` (`src/server/comments/service.ts`) | all in `body` | `comment` |
| `updateComment` | in new `body`, not in old `body` | `comment` |
| `createTask` (`src/server/tasks/service.ts`) | all in `description` | `description` |
| `updateTask` / `updateTaskAndLabels`, description changed | in new, not in old `description` | `description` |

`updateComment` does not call `notifyTaskChange` today; it gains only `notifyMentions`.
Bulk updates and the REST API's writes go through the same service functions, so mentions
written via the API notify too.

### Bell copy — `bellText` (src/lib/notifications.ts)

- `where` = `['comment']`: title `${actorName} mentioned you`, detail `${title}: “${comment}”`.
- `where` = `['description']`: title `${actorName} mentioned you`, detail `in the description of ${title}`.
- Both: title `${actorName} mentioned you`, detail `${title}`.

Clicking the item opens the task, as for `task_change`. The toast comes from the unread count
rising, as for change notifications; no new channel.

### REST API

No change. Bodies are returned as stored Markdown; a mention reads as `[@Ana](mention:…)`.

## UI

### Editor — `src/components/kibo-ui/editor/mention.tsx` (new)

- Dependency `@tiptap/extension-mention@3.31.3`, pinned like the other Tiptap packages.
- Mention node configured with `renderMarkdown` → `[@label](mention:id)` and a Markdown
  parse rule turning `mention:` links back into the node. First plan step verifies the
  extension's Markdown hooks accept the link form; if not, a small custom inline atom Node
  (`id`, `label` attrs) with the same hooks replaces it.
- Suggestion on `@`, own `PluginKey`, popup built like `SlashMenu`: cmdk list (avatar + name),
  filtered by name or email (case-insensitive), max 8; arrow/enter forwarded via a
  `forwardToMenu` equivalent targeting `#mention-menu`; popup mounted inside the surrounding
  dialog; Escape closes the popup without closing the dialog.
- In the editor the node shows as a chip; it is an atom, so Backspace removes it whole.

### `RichTextField`

- Optional `members?: MemberRow[]`. The mention extension is added only when `members` is
  passed.
- Passed from: comment composer and comment edit (`ActivityFeed.tsx`), `DescriptionField.tsx`,
  `CreateTaskDialog.tsx` (`options.members`).

### Rendering — `src/components/task/Markdown.tsx`

- `urlTransform`: keep react-markdown's default, except allow hrefs starting with `mention:`.
- `a` with a `mention:` href renders `<span className="mention">`, not a link. Text = current
  name of the member with that id when `members` is given and contains it; else the stored link
  text. Your own mention (id = current user) gets the stronger tint.
- `Markdown` gains optional `members` and `currentUserId` props; callers that have them pass them.
- `.mention` chip style in globals (brand tint, rounded, no underline).

## Edge cases

- Self-mention: renders, never notifies.
- Id not a current member (left workspace, hand-typed, via API): renders stored text, never notifies.
- Same member mentioned twice in one write: one item.
- Mention inside code: plain text, no notification.
- Comment/description deleted: no retraction; the bell item stays until read, and is removed with
  the task by the existing `task_id` cascade.

## Testing

- **Unit** (`tests/unit`): `extractMentionIds` (dedupe, order, code fences/spans, malformed
  links), `mentionsToText`, `commentExcerpt` with mentions, editor Markdown round-trip of a mention.
- **Server** (`tests/server`): create comment → mentioned member notified, actor and non-member
  skipped; update comment → only newly added ids; description on create and on update (diff);
  `change_notify = false` member still gets the mention; assignee who is mentioned gets one
  `mention` item and no `task_change` for that write; second mention while unread merges.
- **e2e** (`tests/e2e/mentions.spec.ts`): type `@`, pick a teammate, post → chip renders; the
  teammate's bell shows "mentioned you".
