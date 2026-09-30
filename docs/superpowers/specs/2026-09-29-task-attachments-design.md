# Task Attachments — Design Spec

**Date:** 2026-09-29
**Status:** Approved design, not yet implemented
**Branch:** `feat/task-attachments` (from `chore/small-changes` at `39db2f4`)
**Scope:** Workspace members attach files to a task, see them on the task detail, download or
preview them, and delete them. Files live in Cloudflare R2 (S3-compatible); metadata lives in
Postgres.

## 1. Purpose

Tasks need supporting files — screenshots, specs, exports. Today there is nowhere to put them.

### Success criteria

- A member attaches one or more files (up to 25 MB each, any type) to a task from the task
  detail, with visible per-file progress.
- Teammates in the same workspace see the files, download them, and preview images and PDFs
  in the browser.
- The uploader, or a workspace owner/admin, can delete an attachment.
- No file or metadata is readable from another workspace, and the bucket is never public.
- File bytes never pass through the Next.js server.
- Adding and removing attachments shows in the task's History.

### Non-goals (v1)

- Attachments on comments.
- Inline images pasted or dropped into the description/comment editor.
- Import from URL (would make the server fetch arbitrary URLs: SSRF risk, bytes through server).
- Per-workspace storage quotas.
- Attachment count on board cards or list rows.
- Files larger than 25 MB (would need multipart upload).

## 2. Storage

### 2.1 Provider

- **Production:** Cloudflare R2. Private bucket, no public access, no custom domain needed.
- **Development and tests:** MinIO in `docker-compose.yml`. Buckets are created by
  `yarn storage:init`; MinIO allows any origin by default, so dev needs no CORS rule.

Both are reached through the same S3 client, so there is one code path.

### 2.2 Configuration (`.env.example`)

```
# S3-compatible object storage for task attachments. Cloudflare R2 in production
# (endpoint https://<account-id>.r2.cloudflarestorage.com, region auto), MinIO locally.
# Leave S3_BUCKET empty to turn attachments off; the section is then hidden.
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=taskeeper
S3_ACCESS_KEY_ID=taskeeper
S3_SECRET_ACCESS_KEY=taskeeper-secret
# Bucket used by the test suite; emptied between tests.
S3_BUCKET_TEST=taskeeper-test
```

MinIO needs path-style addressing (`forcePathStyle: true`); R2 accepts it too, so it is always on.

### 2.3 Bucket CORS

The browser uploads with `PUT` straight to the bucket, so the bucket must allow the app origin:

- Allowed origins: `BETTER_AUTH_URL` (and `http://localhost:3000` for dev).
- Allowed methods: `PUT`, `GET`, `HEAD`.
- Allowed headers: `content-type`.
- Max age: 3600.

The README gains a short "Attachments on R2" section: create bucket, create an API token with
Object Read & Write on that bucket only, set the CORS rule above, fill the env vars.

### 2.4 Storage module — `src/lib/storage.ts`

Thin wrapper over `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Server-only.

| Function | Purpose |
|---|---|
| `storageEnabled(): boolean` | True when `S3_BUCKET` and credentials are set. |
| `presignPut({ key, contentType, size })` | Signed `PUT` URL, 5 min. `Content-Type` and `Content-Length` are part of the signature, so the browser cannot upload a different size or type. |
| `presignGet({ key, fileName, contentType, inline })` | Signed `GET` URL, 5 min, with `response-content-disposition` and `response-content-type` overrides. |
| `headObject(key)` | Size + content type of an uploaded object, or null if missing. |
| `deleteObject(key)` | Idempotent delete. |
| `listKeys(prefix)` / `deleteObjects(keys)` | Used only by the sweep script and tests. |

The bucket name is read per call so tests can point at `S3_BUCKET_TEST`.

## 3. Data model

New table in `src/db/schema/attachment.ts`, exported from the schema index, one Drizzle
migration.

```ts
export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'ready']);

export const attachment = pgTable('attachment', {
  id: text('id').primaryKey(),
  // Denormalized like comment.workspace_id: tenancy is one predicate.
  workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  // Null once the uploader deletes their account; the UI shows "Deleted user".
  uploaderId: text('uploader_id').references(() => user.id, { onDelete: 'set null' }),
  key: text('key').notNull().unique(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  status: attachmentStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('attachment_task_created_idx').on(t.taskId, t.createdAt)]);
```

- **Object key:** `ws/{workspaceId}/tasks/{taskId}/{attachmentId}`. The user's file name is
  never part of the key; it is stored in `file_name` and only used in `Content-Disposition`.
- **File name:** trimmed, path separators and control characters stripped, max 255 chars,
  falls back to `file`.
- **Content type:** the browser-reported type if it matches `type/subtype`, else
  `application/octet-stream`. Max 255 chars.
- **Size:** 1 byte to 25 MB (`MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024`), shared constant used
  by client and server.
- Only `ready` rows are ever shown or downloadable.

## 4. Server

### 4.1 Service — `src/server/attachments/service.ts`

All functions take `WorkspaceContext`, validate with zod, and return `Result`, matching
`src/server/comments/service.ts`.

**`requestUpload(ctx, { taskId, fileName, contentType, size })` → `{ id, url }`**
1. Storage enabled, else `err('Attachments are not set up.')`.
2. Task exists in `ctx.workspaceId`, else `err('Task not found.')`.
3. Size within limits, else `err('Files can be up to 25 MB.')`.
4. Insert `pending` row with `uploaderId = ctx.userId`.
5. Return the id and a presigned `PUT` URL.

**`confirmUpload(ctx, { attachmentId })` → `AttachmentView`**
1. Load the row in `ctx.workspaceId` with `uploaderId = ctx.userId` and `status = 'pending'`.
2. `headObject(key)`: missing → `err('Upload did not finish.')`; size differs from the row →
   delete object and row, `err('Upload did not finish.')`.
3. In one transaction: set `status = 'ready'`, `recordActivity(kind: 'attachment_added',
   to: fileName)`.
4. Return the attachment as shown in the list.

**`deleteAttachment(ctx, { attachmentId })`**
1. Load a `ready` row in `ctx.workspaceId`, else `err('Attachment not found.')`.
2. Allowed for the uploader or `owner`/`admin`, else
   `err('You can only delete your own attachments.')`.
3. In one transaction: delete row, `recordActivity(kind: 'attachment_removed', from: fileName)`.
4. After commit, `deleteObject(key)` best-effort; a failure is logged and left to the sweep.

**`cancelUpload(ctx, { attachmentId })`** — uploader drops their own `pending` row and
best-effort deletes the object. Used by the ✕ on an uploading card.

### 4.2 Queries — `src/server/attachments/queries.ts`

`listTaskAttachments(ctx, taskId)` → `ready` rows, newest first, joined with uploader name and
image. Loaded with the task detail, like subtasks and activity.

### 4.3 Actions — `src/server/attachments/actions.ts`

Slug-taking wrappers (`requestUploadAction`, `confirmUploadAction`, `cancelUploadAction`,
`deleteAttachmentAction`) via `requireWorkspace` + `withAction`; confirm and delete
revalidate the workspace layout, as comment actions do.

### 4.4 Download route — `src/app/api/attachments/[id]/route.ts`

`GET /api/attachments/{id}`:
1. Session required, else 401.
2. Load the `ready` attachment joined with a `member` row for `(attachment.workspaceId,
   session userId)` in one query — no membership, no row → 404 (not 403, so ids do not leak
   existence).
3. 302 redirect to `presignGet` with `Cache-Control: private, no-store` on the redirect.

**Inline vs download:** `inline` only for `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
`image/avif` and `application/pdf`. Everything else — including `image/svg+xml`, `text/html`
and anything unknown — is served `attachment` with `application/octet-stream`, so no uploaded
file can run script on the bucket origin. `?download=1` forces `attachment` for any type.
File names go into `Content-Disposition` as RFC 6266 `filename*=UTF-8''…` plus an ASCII
fallback.

The same URL is used for image thumbnails (`<img src>`), so thumbnails need no extra endpoint.

### 4.5 Activity

`ACTIVITY_KINDS` gains `'attachment_added'` and `'attachment_removed'`. The History feed renders
"attached **file.pdf**" and "removed attachment **file.pdf**".

### 4.6 Orphan sweep — `scripts/sweep-attachments.ts`

Objects can outlive rows: a browser that uploads and never confirms, a failed best-effort
delete, and cascade deletes of tasks, projects, workspaces. The script (run manually or by
cron, `yarn tsx scripts/sweep-attachments.ts`):
1. Deletes `pending` rows older than 24 h and their objects.
2. Lists all keys under `ws/` and deletes those with no `attachment` row.
3. Prints counts. `--dry-run` prints without deleting.

## 5. UI

Look follows AlignUI Pro "File Upload 01" (file item states) and "File Upload 03" (upload
modal). The free AlignUI primitives are copied into `src/components/ui/`, like the other Align
components:

- `file-upload.tsx` — dashed dropzone root, button, icon.
- `file-format-icon.tsx` — page glyph with a colored extension badge (PDF red, image blue,
  doc sky, sheet green, zip orange, other gray).
- `progress-bar.tsx` — thin progress track.

### 5.1 Attachments section — `src/components/task/AttachmentSection.tsx`

Placed in `TaskDetailView` between Subtasks and Activity. Hidden entirely when storage is off.

- Header: "Attachments" with a count, and an "Attach files" button that opens the modal.
- Ready files as File Upload 01 "completed" cards: format icon (or image thumbnail),
  file name, "size · uploader · relative date", trash button when the viewer may delete.
  Clicking the card opens `/api/attachments/{id}` in a new tab; a download button uses
  `?download=1`.
- Grid: 2 columns on desktop, 1 on phones.
- Files dropped on the section start uploading without opening the modal.
- In-progress uploads for this task also show here (see 5.3).
- Empty state: a compact dropzone, "Drop files here or browse", "Any file type, up to 25 MB."
- Delete asks through the existing confirm modal.

### 5.2 Upload modal — `src/components/task/AttachmentUploadModal.tsx`

Built on the existing `modal.tsx`, laid out like File Upload 03:

- Header: cloud-upload icon, "Upload files", "Attach files to this task", close button.
- Dropzone: "Choose a file or drag & drop it here", "Any file type, up to 25 MB.",
  "Browse File" button. `multiple`, keyboard reachable (label wraps a hidden input).
- Queue of File Upload 01 cards for this session:
  - **Uploading:** spinner, "12 KB of 120 KB · Uploading…", progress bar, ✕ cancels.
  - **Completed:** check icon, "120 KB · Completed", trash deletes.
  - **Failed:** red border, alert icon and reason ("Files can be up to 25 MB.", "Upload
    failed."), "Try Again" link when the failure is retryable.
- Closing the modal does not stop running uploads.

### 5.3 Upload queue — `src/components/task/use-attachment-uploads.ts`

Client hook holding the queue per task (a small store, so the section and modal share it):

1. Reject files over 25 MB or empty locally as Failed, no request.
2. `requestUploadAction` → `XMLHttpRequest` `PUT` with `Content-Type`, reporting
   `upload.onprogress`; ✕ calls `xhr.abort()` then `cancelUploadAction`.
3. `confirmUploadAction` → card turns Completed; the ready list refreshes via
   `router.refresh()`, as other task mutations do.
4. Up to 3 uploads run at once; the rest wait as "Queued".
5. A toast only for failures when the modal is closed.

## 6. Testing

- **Server (`tests/server/attachments.test.ts`, against MinIO test bucket):** request/confirm
  happy path; task from another workspace → not found; 25 MB + 1 byte rejected; confirm
  without upload and with wrong size fails and cleans up; confirm by another user fails;
  delete by uploader, by admin, refused for another member; activity rows written; list shows
  only `ready` rows; cross-workspace tenancy cases added to `tenancy.test.ts`.
- **Unit (`tests/unit/`):** file-name sanitising, content-type normalising, inline/attachment
  decision, `Content-Disposition` encoding, format-icon color mapping.
- **Route:** download route returns 302 for a member, 404 for a non-member and a pending row,
  401 without a session.
- **Sweep:** stale pending rows and keyless objects removed; `--dry-run` deletes nothing.
- **E2E (`tests/e2e/attachments.spec.ts`):** attach a file through the modal, see it listed
  after reload, open it, delete it, see the History entries.

## 7. Dependencies

- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (exact versions pinned like the rest
  of `package.json`).
- Docker images: `minio/minio`, `minio/mc`.
