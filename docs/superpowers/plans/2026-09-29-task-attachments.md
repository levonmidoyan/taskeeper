# Task Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workspace members attach files (≤ 25 MB, any type) to a task, see them on the task detail, open/download them, and delete them, with files stored in Cloudflare R2 (MinIO locally).

**Architecture:** The browser uploads straight to the bucket with a presigned `PUT` URL issued by a server action; a second action checks the object with `HEAD` and flips the Postgres row from `pending` to `ready`. Downloads go through `GET /api/attachments/[id]`, which checks membership and 302-redirects to a short-lived presigned `GET`. The UI copies AlignUI's free FileUpload / FileFormatIcon / ProgressBar primitives and lays them out like AlignUI Pro "File Upload 01/03".

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), Drizzle + Postgres, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1142.0, MinIO (docker), Vitest, Playwright, AlignUI + Tabler icons.

**Spec:** `docs/superpowers/specs/2026-09-29-task-attachments-design.md`

## Global Constraints

- Max file size `25 * 1024 * 1024` bytes; min 1 byte. Any content type.
- Object key format: `ws/{workspaceId}/tasks/{taskId}/{attachmentId}` — never contains the user's file name.
- Presigned URLs (PUT and GET) expire after 300 seconds.
- Inline only for `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `application/pdf`; everything else is `attachment` + `application/octet-stream`.
- Delete allowed for the uploader or workspace `owner`/`admin`.
- Non-member / missing / pending download → 404; no session → 401.
- Error copy (exact): `'Attachments are not set up.'`, `'Task not found.'`, `'Files can be up to 25 MB.'`, `'Upload did not finish.'`, `'Attachment not found.'`, `'You can only delete your own attachments.'`, `'Upload failed.'`.
- Every server function takes `WorkspaceContext` and returns `Result<T>` through `withAction` (see `src/server/comments/service.ts`). Actions files export slug-taking wrappers only.
- Dependencies pinned exact (no `^`), like the rest of `package.json`.
- Icons: `@tabler/icons-react` only. No hex colors outside `src/components/ui/`.
- Commit messages: plain Conventional Commits. **No `Co-Authored-By` or any attribution trailer.**
- Do not change `package.json` `version`.
- AGENTS.md: this Next.js has breaking changes. Before writing the route handler read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.

## Review Focus

1. **Browser uploads a different number of bytes than it declared** → storage rejects the PUT (signed `Content-Length`), and confirm never marks it ready. Pinned in Task 1 (`rejects a body of a different size than was signed`) and Task 4 (`confirm with a wrong size removes row and object`).
2. **File names with paths, quotes, control chars, emoji or 1000 chars** → stored name is the last segment, cleaned, ≤ 255 code points, and `Content-Disposition` stays a valid header. Pinned in Task 2.
3. **An HTML/SVG file opened via its link** → served as `attachment` + `application/octet-stream`, never rendered on the bucket origin. Pinned in Task 2 (`isInlineType`) and Task 5 (`download of an svg is forced to attachment`).
6. **User presses ✕ while the upload URL is still being requested** → the upload never completes and no attachment appears. Guarded in Task 8's runner (`gone()` checks); exercised manually in Task 9 Step 6.3.
4. **User removed from the workspace keeps an old attachment link** → 404, not the file. Pinned in Task 5 (`404 once the user leaves the workspace`).
5. **Upload cancelled or tab closed mid-upload** → pending row never shows in the list, and the sweep removes it plus its object after 24 h. Pinned in Task 4 (`list hides pending rows`) and Task 6.

---

## File map

| File | Responsibility |
|---|---|
| `docker-compose.yml` (modify) | Adds `minio` service. |
| `scripts/storage-init.ts` (create) | Creates dev + test buckets. `yarn storage:init`. |
| `src/lib/storage.ts` (create) | S3 client wrapper: presign PUT/GET, head, delete, list. Server-only. |
| `tests/setup/storage.ts` (create) | Test helpers: ensure/empty test bucket, upload via presigned URL. |
| `src/lib/attachments.ts` (create) | Pure helpers shared by client + server: limits, name/type cleaning, inline rule, disposition, key, byte formatting, format badge. |
| `src/db/schema/attachment.ts` (create) | `attachment` table + status enum. |
| `src/server/attachments/service.ts` (create) | request/confirm/cancel/delete. |
| `src/server/attachments/queries.ts` (create) | `listTaskAttachments`, `AttachmentView`. |
| `src/server/attachments/actions.ts` (create) | Slug-taking server actions. |
| `src/server/attachments/download.ts` (create) | `resolveDownload` membership check + presign. |
| `src/app/api/attachments/[id]/route.ts` (create) | Thin GET route. |
| `src/server/attachments/sweep.ts` + `scripts/sweep-attachments.ts` (create) | Orphan cleanup. |
| `src/server/activity/service.ts`, `src/lib/activity-text.ts` (modify) | Two new activity kinds. |
| `src/components/ui/{file-upload,file-format-icon,progress-bar}.tsx` (create) | Vendored AlignUI primitives. |
| `src/lib/upload-queue.ts` (create) | Pure upload-queue state transitions. |
| `src/components/task/use-attachment-uploads.ts` (create) | Client store + XHR runner per task. |
| `src/components/task/AttachmentCard.tsx` (create) | File Upload 01 card (ready / uploading / failed / queued). |
| `src/components/task/AttachmentUploadModal.tsx` (create) | File Upload 03 modal. |
| `src/components/task/AttachmentSection.tsx` (create) | Section in task detail. |
| `TaskDetailView.tsx`, `ProjectTaskDialog.tsx`, `tasks/[taskId]/page.tsx` (modify) | Load + render attachments. |

---

### Task 1: Local object storage + storage module

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `package.json`, `tests/setup/env.ts`
- Create: `scripts/storage-init.ts`, `src/lib/storage.ts`, `tests/setup/storage.ts`
- Test: `tests/server/storage.test.ts`

**Interfaces:**
- Produces (`src/lib/storage.ts`):
  - `storageEnabled(): boolean`
  - `presignPut(input: { key: string; contentType: string; size: number }): Promise<string>`
  - `presignGet(input: { key: string; contentType: string; disposition: string }): Promise<string>`
  - `headObject(key: string): Promise<{ size: number; contentType: string | null } | null>`
  - `deleteObject(key: string): Promise<void>`
  - `listKeys(prefix: string): Promise<string[]>`
  - `deleteObjects(keys: string[]): Promise<void>`
  - `ensureBucket(bucket: string): Promise<void>`
  - `storageClient(): S3Client`, `bucketName(): string`
  - `PRESIGN_SECONDS = 300`
- Produces (`tests/setup/storage.ts`): `resetBucket(): Promise<void>`, `uploadTo(url: string, body: Uint8Array, contentType: string): Promise<Response>`

- [ ] **Step 1: Add dependencies**

```bash
yarn add @aws-sdk/client-s3@3.1142.0 @aws-sdk/s3-request-presigner@3.1142.0
```

Then open `package.json` and make sure both entries are exact (`"3.1142.0"`, no `^`). Add scripts:

```json
"storage:init": "tsx scripts/storage-init.ts",
"attachments:sweep": "tsx scripts/sweep-attachments.ts",
```

(`scripts/sweep-attachments.ts` arrives in Task 6.)

- [ ] **Step 2: Add MinIO to `docker-compose.yml`**

Add under `services:` (after `postgres`), and a `taskeeper-minio` volume under `volumes:`:

```yaml
  minio:
    # Pinned: MinIO stopped publishing new community images in late 2025, so
    # this is the last tag we rely on. Any S3-compatible server works here.
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    container_name: taskeeper-minio
    restart: unless-stopped
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: taskeeper
      MINIO_ROOT_PASSWORD: taskeeper-secret
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    volumes:
      - taskeeper-minio:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10
```

```yaml
volumes:
  taskeeper-pgdata:
  taskeeper-minio:
```

MinIO accepts cross-origin requests from any origin by default, so dev needs no CORS rule.

- [ ] **Step 3: Add env vars to `.env.example`** (after the `RESEND_API_KEY` block), and the same values to your local `.env.local`:

```
# S3-compatible object storage for task attachments. Cloudflare R2 in production
# (endpoint https://<account-id>.r2.cloudflarestorage.com, region auto), MinIO
# locally (yarn db:up, then yarn storage:init once to create the buckets).
# Leave S3_BUCKET empty to turn attachments off; the section is then hidden.
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=taskeeper
S3_ACCESS_KEY_ID=taskeeper
S3_SECRET_ACCESS_KEY=taskeeper-secret
# Bucket used by the test suite; emptied between tests.
S3_BUCKET_TEST=taskeeper-test
```

- [ ] **Step 4: Point tests at the test bucket** — append to `tests/setup/env.ts`:

```ts
if (!process.env.S3_BUCKET_TEST) {
  throw new Error('S3_BUCKET_TEST is not set. Copy the S3_* block from .env.example to .env.local.');
}

// Every module that reads S3_BUCKET gets the test bucket during tests.
process.env.S3_BUCKET = process.env.S3_BUCKET_TEST;
```

- [ ] **Step 5: Write `src/lib/storage.ts`**

```ts
import 'server-only';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Lifetime of every presigned URL, upload and download alike. */
export const PRESIGN_SECONDS = 300;

let cached: { signature: string; client: S3Client } | null = null;

/** Read per call, not at import, so tests can swap the bucket in their env setup. */
export function bucketName(): string {
  return process.env.S3_BUCKET ?? '';
}

export function storageEnabled(): boolean {
  return Boolean(
    process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
  );
}

export function storageClient(): S3Client {
  const signature = [
    process.env.S3_ENDPOINT, process.env.S3_REGION, process.env.S3_ACCESS_KEY_ID,
  ].join('|');
  if (cached?.signature === signature) return cached.client;

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    // MinIO needs path-style URLs; R2 accepts them too.
    forcePathStyle: true,
    // Newer SDKs add CRC32 checksum parameters to presigned PUTs by default.
    // A browser cannot compute them, and R2/MinIO then reject the upload.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  cached = { signature, client };
  return client;
}

/**
 * Content-Type and Content-Length are signed, so the browser cannot upload a
 * different type or a bigger file than the server agreed to.
 */
export async function presignPut(input: { key: string; contentType: string; size: number }): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.size,
    }),
    { expiresIn: PRESIGN_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** `disposition` is a full Content-Disposition value from contentDisposition(). */
export async function presignGet(input: { key: string; contentType: string; disposition: string }): Promise<string> {
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: input.disposition,
      ResponseCacheControl: 'private, max-age=300',
    }),
    { expiresIn: PRESIGN_SECONDS },
  );
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const head = await storageClient().send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

/** Idempotent: deleting a missing key succeeds. */
export async function deleteObject(key: string): Promise<void> {
  await storageClient().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await storageClient().send(new ListObjectsV2Command({
      Bucket: bucketName(), Prefix: prefix, ContinuationToken: token,
    }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** DeleteObjects takes at most 1000 keys per call. */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await storageClient().send(new DeleteObjectsCommand({
      Bucket: bucketName(),
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

/** Dev and test setup only; production buckets are created in the R2 dashboard. */
export async function ensureBucket(bucket: string): Promise<void> {
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await storageClient().send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
```

Check `server-only` is resolvable (`grep -rn "'server-only'" src | head -1`). If no file in `src` imports it and it is not in `node_modules`, drop that first line rather than adding a package.

- [ ] **Step 6: Write `scripts/storage-init.ts`**

```ts
import { config } from 'dotenv';

config({ path: '.env.local' });

/** Creates the dev and test buckets on the local MinIO. Safe to run repeatedly. */
async function main() {
  const { ensureBucket } = await import('../src/lib/storage');
  for (const bucket of [process.env.S3_BUCKET, process.env.S3_BUCKET_TEST]) {
    if (!bucket) continue;
    await ensureBucket(bucket);
    console.log(`bucket ready: ${bucket}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

If `import 'server-only'` throws when run from tsx, run the script as `tsx --conditions=react-server scripts/storage-init.ts` in the `storage:init` script instead.

- [ ] **Step 7: Write `tests/setup/storage.ts`**

```ts
import { deleteObjects, ensureBucket, listKeys } from '@/lib/storage';

/** Creates the test bucket on first use and empties it. Call in beforeEach. */
export async function resetBucket(): Promise<void> {
  await ensureBucket(process.env.S3_BUCKET!);
  const keys = await listKeys('');
  if (keys.length) await deleteObjects(keys);
}

/** Does what the browser does with a presigned PUT URL. */
export function uploadTo(url: string, body: Uint8Array, contentType: string): Promise<Response> {
  return fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } });
}
```

If vitest cannot import `server-only`, add to `vitest.config.ts` `resolve.alias`: `'server-only': resolve(__dirname, './tests/setup/empty.ts')` with an empty `tests/setup/empty.ts` (`export {};`).

- [ ] **Step 8: Write the failing test `tests/server/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteObject, headObject, presignGet, presignPut } from '@/lib/storage';
import { resetBucket, uploadTo } from '../setup/storage';

beforeEach(resetBucket);

const bytes = new TextEncoder().encode('hello world');

describe('storage', () => {
  it('uploads through a presigned PUT and reports the size', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/c', contentType: 'text/plain', size: bytes.length });

    const res = await uploadTo(url, bytes, 'text/plain');

    expect(res.ok).toBe(true);
    expect(await headObject('ws/a/tasks/b/c')).toEqual({ size: bytes.length, contentType: 'text/plain' });
  });

  // Review Focus 1.
  it('rejects a body of a different size than was signed', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/big', contentType: 'text/plain', size: 3 });

    const res = await uploadTo(url, bytes, 'text/plain');

    expect(res.ok).toBe(false);
    expect(await headObject('ws/a/tasks/b/big')).toBeNull();
  });

  it('rejects a different content type than was signed', async () => {
    const url = await presignPut({ key: 'ws/a/tasks/b/type', contentType: 'text/plain', size: bytes.length });

    const res = await uploadTo(url, bytes, 'text/html');

    expect(res.ok).toBe(false);
  });

  it('serves a presigned GET with the requested disposition', async () => {
    const put = await presignPut({ key: 'k1', contentType: 'text/plain', size: bytes.length });
    await uploadTo(put, bytes, 'text/plain');

    const url = await presignGet({
      key: 'k1', contentType: 'application/octet-stream', disposition: 'attachment; filename="a.txt"',
    });
    const res = await fetch(url);

    expect(await res.text()).toBe('hello world');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="a.txt"');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('returns null for a missing object and deletes idempotently', async () => {
    expect(await headObject('missing')).toBeNull();
    await expect(deleteObject('missing')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 9: Run and verify**

```bash
yarn db:up && yarn storage:init
yarn vitest run tests/server/storage.test.ts
```

Expected: 5 passing. If "rejects a body of a different size" passes only because Node's fetch errors, that still counts — `res.ok` false or a thrown fetch both mean the upload did not land; if fetch throws, wrap that test's call in `await uploadTo(...).catch(() => ({ ok: false }))`.

- [ ] **Step 10: Update the spec's §2.1** — replace "plus a one-shot `minio/mc` service that creates the dev and test buckets and sets their CORS rule." with "Buckets are created by `yarn storage:init`; MinIO allows any origin by default, so dev needs no CORS rule." Then run `yarn typecheck` and `yarn lint`.

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml .env.example package.json yarn.lock tests/setup scripts/storage-init.ts src/lib/storage.ts tests/server/storage.test.ts docs/superpowers/specs/2026-09-29-task-attachments-design.md vitest.config.ts
git commit -m "feat(attachments): S3 storage module with MinIO for dev and tests"
```

---

### Task 2: Pure attachment helpers

**Files:**
- Create: `src/lib/attachments.ts`
- Test: `tests/unit/attachments.test.ts`

**Interfaces:**
- Produces:
  - `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024`
  - `sanitizeFileName(name: string): string`
  - `normalizeContentType(type: string): string`
  - `isInlineType(contentType: string): boolean`
  - `contentDisposition(fileName: string, inline: boolean): string`
  - `attachmentKey(workspaceId: string, taskId: string, attachmentId: string): string`
  - `formatBytes(bytes: number): string`
  - `type FormatColor = 'red' | 'blue' | 'sky' | 'green' | 'orange' | 'gray'`
  - `fileFormat(fileName: string, contentType: string): { label: string; color: FormatColor }`

- [ ] **Step 1: Write the failing test `tests/unit/attachments.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES, attachmentKey, contentDisposition, fileFormat, formatBytes,
  isInlineType, normalizeContentType, sanitizeFileName,
} from '@/lib/attachments';

describe('sanitizeFileName', () => {
  // Review Focus 2.
  it('keeps only the last path segment', () => {
    expect(sanitizeFileName('C:\\Users\\ada\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });
  it('strips control characters and trims', () => {
    expect(sanitizeFileName('  a\u0000b\nc.txt  ')).toBe('abc.txt');
  });
  it('caps at 255 code points without splitting an emoji', () => {
    const out = sanitizeFileName('😀'.repeat(300));
    expect(Array.from(out)).toHaveLength(255);
    expect(out.endsWith('😀')).toBe(true);
  });
  it('falls back to "file"', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('/')).toBe('file');
  });
});

describe('normalizeContentType', () => {
  it('lowercases and drops parameters', () => {
    expect(normalizeContentType('Text/Plain; charset=UTF-8')).toBe('text/plain');
  });
  it('falls back to octet-stream for junk', () => {
    expect(normalizeContentType('')).toBe('application/octet-stream');
    expect(normalizeContentType('not a type')).toBe('application/octet-stream');
    expect(normalizeContentType(`a/${'b'.repeat(300)}`)).toBe('application/octet-stream');
  });
});

describe('isInlineType', () => {
  // Review Focus 3.
  it('allows safe images and pdf only', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']) {
      expect(isInlineType(t), t).toBe(true);
    }
    for (const t of ['image/svg+xml', 'text/html', 'text/plain', 'application/octet-stream', 'application/xhtml+xml']) {
      expect(isInlineType(t), t).toBe(false);
    }
  });
});

describe('contentDisposition', () => {
  it('encodes UTF-8 names with an ASCII fallback', () => {
    expect(contentDisposition('résumé "v2".pdf', false))
      .toBe(`attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`);
  });
  it('uses inline when asked', () => {
    expect(contentDisposition('a.png', true)).toBe(`inline; filename="a.png"; filename*=UTF-8''a.png`);
  });
  it('encodes characters encodeURIComponent leaves alone', () => {
    expect(contentDisposition("it's (1)*.txt", false))
      .toBe(`attachment; filename="it_s (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`);
  });
});

describe('attachmentKey', () => {
  it('never contains the file name', () => {
    expect(attachmentKey('w1', 't1', 'a1')).toBe('ws/w1/tasks/t1/a1');
  });
});

describe('formatBytes', () => {
  it('formats B, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe('25.0 MB');
  });
});

describe('fileFormat', () => {
  it('labels by extension and colours by kind', () => {
    expect(fileFormat('cv.pdf', 'application/pdf')).toEqual({ label: 'PDF', color: 'red' });
    expect(fileFormat('shot.PNG', 'image/png')).toEqual({ label: 'PNG', color: 'blue' });
    expect(fileFormat('notes.docx', 'application/octet-stream')).toEqual({ label: 'DOCX', color: 'sky' });
    expect(fileFormat('data.csv', 'text/csv')).toEqual({ label: 'CSV', color: 'green' });
    expect(fileFormat('bundle.zip', 'application/zip')).toEqual({ label: 'ZIP', color: 'orange' });
    expect(fileFormat('Makefile', 'application/octet-stream')).toEqual({ label: 'FILE', color: 'gray' });
    expect(fileFormat('archive.verylongext', 'application/octet-stream')).toEqual({ label: 'FILE', color: 'gray' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/unit/attachments.test.ts`
Expected: FAIL — cannot resolve `@/lib/attachments`.

- [ ] **Step 3: Write `src/lib/attachments.ts`**

```ts
/**
 * Attachment rules shared by the browser and the server. Plain functions with
 * no imports, so the client can check a file before asking for an upload URL
 * and the server applies the very same rules.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Last path segment, control characters removed, at most 255 code points. */
export function sanitizeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const capped = Array.from(cleaned).slice(0, 255).join('');
  return capped || 'file';
}

const TOKEN = "[a-z0-9][a-z0-9!#$&^_.+-]*";
const MIME = new RegExp(`^${TOKEN}/${TOKEN}$`);

/** The browser's type without parameters, or octet-stream when it is not a type. */
export function normalizeContentType(type: string): string {
  const essence = type.split(';')[0].trim().toLowerCase();
  return essence.length <= 255 && MIME.test(essence) ? essence : 'application/octet-stream';
}

const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf',
]);

/**
 * Only types a browser shows without running script. SVG and HTML are
 * deliberately absent: opened inline they would run on the bucket's origin.
 */
export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}

/** RFC 6266: an ASCII fallback for old clients plus the exact UTF-8 name. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\']/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentKey(workspaceId: string, taskId: string, attachmentId: string): string {
  return `ws/${workspaceId}/tasks/${taskId}/${attachmentId}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FormatColor = 'red' | 'blue' | 'sky' | 'green' | 'orange' | 'gray';

const EXT_COLOR: Record<string, FormatColor> = {
  pdf: 'red',
  doc: 'sky', docx: 'sky', txt: 'sky', md: 'sky', rtf: 'sky', odt: 'sky',
  xls: 'green', xlsx: 'green', csv: 'green', ods: 'green',
  zip: 'orange', rar: 'orange', '7z': 'orange', gz: 'orange', tar: 'orange',
};

/** The badge on a file icon: its extension (max 4 chars) and a colour by kind. */
export function fileFormat(fileName: string, contentType: string): { label: string; color: FormatColor } {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const label = ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE';
  const color = contentType.startsWith('image/') ? 'blue' : EXT_COLOR[ext] ?? 'gray';
  return { label, color };
}
```

Note the ASCII fallback replaces `'` too (so `it's` → `it_s`), matching the test.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn vitest run tests/unit/attachments.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments.ts tests/unit/attachments.test.ts
git commit -m "feat(attachments): shared name, type and disposition rules"
```

---

### Task 3: Schema, migration, activity kinds

**Files:**
- Create: `src/db/schema/attachment.ts`, `drizzle/0010_*.sql` (generated)
- Modify: `src/db/schema/index.ts`, `tests/setup/db.ts`, `src/server/activity/service.ts`, `src/lib/activity-text.ts`
- Test: `tests/unit/activity-text.test.ts`

**Interfaces:**
- Produces: `attachment` table export from `@/db` with columns `id, workspaceId, taskId, uploaderId, key, fileName, contentType, size, status, createdAt`; `attachmentStatusEnum`.
- Produces: `ActivityKind` now includes `'attachment_added' | 'attachment_removed'`.

- [ ] **Step 1: Write the failing activity text tests** — append inside the `describe('describeActivity', ...)` block of `tests/unit/activity-text.test.ts`:

```ts
  it('describes adding an attachment', () => {
    expect(describeActivity(activity({ kind: 'attachment_added', to: 'spec.pdf' })))
      .toBe('attached “spec.pdf”');
  });

  it('describes removing an attachment', () => {
    expect(describeActivity(activity({ kind: 'attachment_removed', from: 'spec.pdf' })))
      .toBe('removed attachment “spec.pdf”');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/unit/activity-text.test.ts`
Expected: FAIL (type error / undefined return).

- [ ] **Step 3: Add the kinds** — in `src/server/activity/service.ts`:

```ts
export const ACTIVITY_KINDS = [
  'created', 'title', 'status', 'priority', 'assignee', 'due_date',
  'attachment_added', 'attachment_removed',
] as const;
```

In `src/lib/activity-text.ts`, add to the switch:

```ts
    case 'attachment_added':
      return `attached “${entry.to}”`;
    case 'attachment_removed':
      return `removed attachment “${entry.from}”`;
```

- [ ] **Step 4: Write `src/db/schema/attachment.ts`**

```ts
import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { task } from './task';

export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'ready']);

export const attachment = pgTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    // Denormalized like comment.workspace_id (spec §3.3): the tenancy filter is
    // one predicate, never a join through task -> project.
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    // Null once the uploader deletes their account; the UI shows "Deleted user".
    uploaderId: text('uploader_id').references(() => user.id, { onDelete: 'set null' }),
    // ws/{workspaceId}/tasks/{taskId}/{id}; the user's file name is never in it.
    key: text('key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    // Pending from the moment an upload URL is issued until the object is
    // checked. Only ready rows are listed or downloadable.
    status: attachmentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachment_task_created_idx').on(t.taskId, t.createdAt)],
);
```

Add `export * from './attachment';` to `src/db/schema/index.ts`.

- [ ] **Step 5: Add the table to the test truncate** — in `tests/setup/db.ts`, make the list start `attachment, todo, project_star, ...`.

- [ ] **Step 6: Generate and apply the migration**

```bash
yarn db:generate --name attachments
yarn db:migrate
DATABASE_URL_DIRECT="$(grep ^DATABASE_URL_TEST= .env.local | cut -d= -f2-)" yarn db:migrate
```

Open the generated `drizzle/0010_attachments.sql` and check it only creates the enum, the table, the unique constraint, the index and three FKs.

- [ ] **Step 7: Run tests**

Run: `yarn vitest run tests/unit/activity-text.test.ts tests/server/schema.test.ts && yarn typecheck`
Expected: PASS. If `schema.test.ts` enumerates tables, add `attachment` to its expected list.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema drizzle tests/setup/db.ts src/server/activity/service.ts src/lib/activity-text.ts tests/unit/activity-text.test.ts tests/server/schema.test.ts
git commit -m "feat(attachments): attachment table and activity kinds"
```

---

### Task 4: Attachment service, queries, actions

**Files:**
- Create: `src/server/attachments/service.ts`, `src/server/attachments/queries.ts`, `src/server/attachments/actions.ts`
- Test: `tests/server/attachments.test.ts`

**Interfaces:**
- Consumes: Task 1 storage functions, Task 2 helpers, Task 3 `attachment` table, `recordActivity(ctx, { taskId, kind, from?, to? }, tx)`.
- Produces (`queries.ts`):
  ```ts
  export type AttachmentView = {
    id: string; fileName: string; contentType: string; size: number; createdAt: Date;
    uploaderId: string | null; uploaderName: string; uploaderImage: string | null;
  };
  export function listTaskAttachments(ctx: WorkspaceContext, taskId: string): Promise<AttachmentView[]>;
  export function getAttachmentView(ctx: WorkspaceContext, attachmentId: string): Promise<AttachmentView | null>;
  ```
- Produces (`service.ts`):
  ```ts
  requestUpload(ctx, { taskId: string; fileName: string; contentType: string; size: number }): Promise<Result<{ id: string; url: string; contentType: string }>>
  confirmUpload(ctx, { attachmentId: string }): Promise<Result<AttachmentView>>
  cancelUpload(ctx, { attachmentId: string }): Promise<Result<null>>
  deleteAttachment(ctx, { attachmentId: string }): Promise<Result<null>>
  ```
  `requestUpload` returns the normalized `contentType`; the browser must send exactly that as the PUT `Content-Type`.
- Produces (`actions.ts`): `requestUploadAction(slug, input)`, `confirmUploadAction(slug, input)`, `cancelUploadAction(slug, input)`, `deleteAttachmentAction(slug, input)` — same inputs/outputs as the service.

- [ ] **Step 1: Write the failing test `tests/server/attachments.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import { attachment, taskActivity } from '@/db';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { headObject } from '@/lib/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import {
  cancelUpload, confirmUpload, deleteAttachment, requestUpload,
} from '@/server/attachments/service';
import { listTaskAttachments } from '@/server/attachments/queries';

beforeEach(async () => {
  await resetDb();
  await resetBucket();
});
afterAll(closeDb);

const bytes = new TextEncoder().encode('attachment body');

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error('setup failed');
  const made = await createTask(ctx, { projectId: project.data.id, title: 'Ship v1' });
  if (!made.ok) throw new Error('setup failed');
  return { ctx, ws, taskId: made.data.id };
}

async function addMember(workspaceId: string, slug: string, email: string, role: 'admin' | 'member') {
  const user = await createUser(email, 'Grace');
  await joinWorkspace(user.id, workspaceId, role);
  const ctx: WorkspaceContext = { userId: user.id, workspaceId, slug, role, timezone: 'Asia/Yerevan' };
  return ctx;
}

/** request -> PUT -> confirm, the whole happy path. */
async function attach(ctx: WorkspaceContext, taskId: string, fileName = 'notes.txt') {
  const req = await requestUpload(ctx, { taskId, fileName, contentType: 'text/plain', size: bytes.length });
  if (!req.ok) throw new Error(req.error);
  const put = await uploadTo(req.data.url, bytes, req.data.contentType);
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  const done = await confirmUpload(ctx, { attachmentId: req.data.id });
  if (!done.ok) throw new Error(done.error);
  return done.data;
}

describe('requestUpload', () => {
  it('creates a pending row owned by the caller', async () => {
    const { ctx, taskId } = await setup('a1@example.com', 'ws-a1');

    const result = await requestUpload(ctx, {
      taskId, fileName: '../secret/Report.PDF', contentType: 'Application/PDF', size: 10,
    });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(attachment);
    expect(row).toMatchObject({
      status: 'pending', fileName: 'Report.PDF', contentType: 'application/pdf',
      size: 10, uploaderId: ctx.userId, workspaceId: ctx.workspaceId, taskId,
      key: `ws/${ctx.workspaceId}/tasks/${taskId}/${row.id}`,
    });
  });

  it('refuses a task in another workspace', async () => {
    const a = await setup('a2a@example.com', 'ws-a2a');
    const b = await setup('a2b@example.com', 'ws-a2b');

    const result = await requestUpload(b.ctx, { taskId: a.taskId, fileName: 'x', contentType: 'text/plain', size: 1 });

    expect(result).toEqual({ ok: false, error: 'Task not found.' });
    expect(await db.select().from(attachment)).toHaveLength(0);
  });

  it('refuses files over 25 MB and empty files', async () => {
    const { ctx, taskId } = await setup('a3@example.com', 'ws-a3');

    for (const size of [MAX_ATTACHMENT_BYTES + 1, 0]) {
      const result = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size });
      expect(result).toEqual({ ok: false, error: 'Files can be up to 25 MB.' });
    }
    expect(await db.select().from(attachment)).toHaveLength(0);
  });

  it('accepts exactly 25 MB', async () => {
    const { ctx, taskId } = await setup('a3b@example.com', 'ws-a3b');
    const result = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: MAX_ATTACHMENT_BYTES });
    expect(result.ok).toBe(true);
  });

  it('is off when storage is not configured', async () => {
    const { ctx, taskId } = await setup('a4@example.com', 'ws-a4');
    const saved = process.env.S3_BUCKET;
    process.env.S3_BUCKET = '';
    try {
      const result = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: 1 });
      expect(result).toEqual({ ok: false, error: 'Attachments are not set up.' });
    } finally {
      process.env.S3_BUCKET = saved;
    }
  });
});

describe('confirmUpload', () => {
  it('marks the row ready, records activity and returns the view', async () => {
    const { ctx, taskId } = await setup('b1@example.com', 'ws-b1');

    const view = await attach(ctx, taskId, 'spec.txt');

    expect(view).toMatchObject({ fileName: 'spec.txt', size: bytes.length, uploaderName: 'Ada' });
    const [row] = await db.select().from(attachment);
    expect(row.status).toBe('ready');
    const activity = await db.select().from(taskActivity).where(eq(taskActivity.kind, 'attachment_added'));
    expect(activity).toHaveLength(1);
    expect(activity[0].toValue).toBe('spec.txt');
  });

  it('fails when nothing was uploaded and keeps the row pending', async () => {
    const { ctx, taskId } = await setup('b2@example.com', 'ws-b2');
    const req = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: 5 });
    if (!req.ok) throw new Error();

    const result = await confirmUpload(ctx, { attachmentId: req.data.id });

    expect(result).toEqual({ ok: false, error: 'Upload did not finish.' });
    const [row] = await db.select().from(attachment);
    expect(row.status).toBe('pending');
  });

  // Review Focus 1: an object of the wrong size is removed with its row.
  it('confirm with a wrong size removes row and object', async () => {
    const { ctx, taskId } = await setup('b3@example.com', 'ws-b3');
    const req = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: bytes.length });
    if (!req.ok) throw new Error();
    await uploadTo(req.data.url, bytes, 'text/plain');
    // Simulate a mismatch the signature could not catch: the row claims more.
    await db.update(attachment).set({ size: bytes.length + 1 }).where(eq(attachment.id, req.data.id));

    const result = await confirmUpload(ctx, { attachmentId: req.data.id });

    expect(result).toEqual({ ok: false, error: 'Upload did not finish.' });
    expect(await db.select().from(attachment)).toHaveLength(0);
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${req.data.id}`)).toBeNull();
  });

  it('refuses another user confirming someone else’s upload', async () => {
    const { ctx, ws, taskId } = await setup('b4@example.com', 'ws-b4');
    const other = await addMember(ws.id, 'ws-b4', 'b4o@example.com', 'admin');
    const req = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: bytes.length });
    if (!req.ok) throw new Error();
    await uploadTo(req.data.url, bytes, 'text/plain');

    expect(await confirmUpload(other, { attachmentId: req.data.id }))
      .toEqual({ ok: false, error: 'Upload did not finish.' });
  });

  it('refuses confirming twice', async () => {
    const { ctx, taskId } = await setup('b5@example.com', 'ws-b5');
    const view = await attach(ctx, taskId);

    expect(await confirmUpload(ctx, { attachmentId: view.id }))
      .toEqual({ ok: false, error: 'Upload did not finish.' });
    expect(await db.select().from(taskActivity).where(eq(taskActivity.kind, 'attachment_added'))).toHaveLength(1);
  });
});

describe('cancelUpload', () => {
  it('drops the caller’s pending row and object', async () => {
    const { ctx, taskId } = await setup('c1@example.com', 'ws-c1');
    const req = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: bytes.length });
    if (!req.ok) throw new Error();
    await uploadTo(req.data.url, bytes, 'text/plain');

    expect(await cancelUpload(ctx, { attachmentId: req.data.id })).toEqual({ ok: true, data: null });
    expect(await db.select().from(attachment)).toHaveLength(0);
  });

  it('cannot cancel a ready attachment', async () => {
    const { ctx, taskId } = await setup('c2@example.com', 'ws-c2');
    const view = await attach(ctx, taskId);

    expect(await cancelUpload(ctx, { attachmentId: view.id })).toEqual({ ok: false, error: 'Attachment not found.' });
    expect(await db.select().from(attachment)).toHaveLength(1);
  });
});

describe('deleteAttachment', () => {
  it('lets the uploader delete, removes the object and records activity', async () => {
    const { ctx, taskId } = await setup('d1@example.com', 'ws-d1');
    const view = await attach(ctx, taskId, 'old.txt');

    expect(await deleteAttachment(ctx, { attachmentId: view.id })).toEqual({ ok: true, data: null });
    expect(await db.select().from(attachment)).toHaveLength(0);
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${view.id}`)).toBeNull();
    const [removed] = await db.select().from(taskActivity).where(eq(taskActivity.kind, 'attachment_removed'));
    expect(removed.fromValue).toBe('old.txt');
  });

  it('lets an admin delete someone else’s attachment', async () => {
    const { ws, taskId } = await setup('d2@example.com', 'ws-d2');
    const member = await addMember(ws.id, 'ws-d2', 'd2m@example.com', 'member');
    const admin = await addMember(ws.id, 'ws-d2', 'd2a@example.com', 'admin');
    const view = await attach(member, taskId);

    expect((await deleteAttachment(admin, { attachmentId: view.id })).ok).toBe(true);
  });

  it('refuses a plain member deleting someone else’s attachment', async () => {
    const { ctx, ws, taskId } = await setup('d3@example.com', 'ws-d3');
    const member = await addMember(ws.id, 'ws-d3', 'd3m@example.com', 'member');
    const view = await attach(ctx, taskId);

    expect(await deleteAttachment(member, { attachmentId: view.id }))
      .toEqual({ ok: false, error: 'You can only delete your own attachments.' });
    expect(await db.select().from(attachment)).toHaveLength(1);
  });

  it('refuses an attachment from another workspace', async () => {
    const a = await setup('d4a@example.com', 'ws-d4a');
    const b = await setup('d4b@example.com', 'ws-d4b');
    const view = await attach(a.ctx, a.taskId);

    expect(await deleteAttachment(b.ctx, { attachmentId: view.id }))
      .toEqual({ ok: false, error: 'Attachment not found.' });
  });
});

describe('listTaskAttachments', () => {
  // Review Focus 5.
  it('list hides pending rows and other workspaces, newest first', async () => {
    const { ctx, taskId } = await setup('e1@example.com', 'ws-e1');
    const first = await attach(ctx, taskId, 'first.txt');
    const second = await attach(ctx, taskId, 'second.txt');
    await requestUpload(ctx, { taskId, fileName: 'pending.txt', contentType: 'text/plain', size: 3 });
    const other = await setup('e1b@example.com', 'ws-e1b');

    const list = await listTaskAttachments(ctx, taskId);

    expect(list.map((a) => a.id)).toEqual([second.id, first.id]);
    expect(await listTaskAttachments(other.ctx, taskId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/server/attachments.test.ts`
Expected: FAIL — cannot resolve `@/server/attachments/service`.

- [ ] **Step 3: Write `src/server/attachments/queries.ts`**

```ts
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { attachment, db, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

export type AttachmentView = {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: Date;
  /** Null once the uploader has deleted their account. */
  uploaderId: string | null;
  uploaderName: string;
  uploaderImage: string | null;
};

/** Shown in place of a name whose account has since been deleted. */
const DELETED_USER = 'Deleted user';

async function selectViews(where: SQL | undefined): Promise<AttachmentView[]> {
  const rows = await db
    .select({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      uploaderId: attachment.uploaderId,
      uploaderName: user.name,
      uploaderImage: user.image,
    })
    .from(attachment)
    .leftJoin(user, eq(user.id, attachment.uploaderId))
    .where(where)
    .orderBy(desc(attachment.createdAt), desc(attachment.id));
  return rows.map((r) => ({ ...r, uploaderName: r.uploaderName ?? DELETED_USER }));
}

/** Ready attachments only: a pending row is an upload still in flight or abandoned. */
export function listTaskAttachments(ctx: WorkspaceContext, taskId: string): Promise<AttachmentView[]> {
  return selectViews(and(
    eq(attachment.taskId, taskId),
    eq(attachment.workspaceId, ctx.workspaceId),
    eq(attachment.status, 'ready'),
  ));
}

export async function getAttachmentView(ctx: WorkspaceContext, attachmentId: string): Promise<AttachmentView | null> {
  const [view] = await selectViews(and(
    eq(attachment.id, attachmentId),
    eq(attachment.workspaceId, ctx.workspaceId),
    eq(attachment.status, 'ready'),
  ));
  return view ?? null;
}
```

- [ ] **Step 4: Write `src/server/attachments/service.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { attachment, db, task } from '@/db';
import {
  MAX_ATTACHMENT_BYTES, attachmentKey, normalizeContentType, sanitizeFileName,
} from '@/lib/attachments';
import { newId } from '@/lib/ids';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { deleteObject, headObject, presignPut, storageEnabled } from '@/lib/storage';
import { recordActivity } from '@/server/activity/service';
import { getAttachmentView, type AttachmentView } from './queries';

const NOT_SET_UP = 'Attachments are not set up.';
const UNFINISHED = 'Upload did not finish.';
const NOT_FOUND = 'Attachment not found.';

/** Best-effort: a failed delete leaves an orphan for the sweep, never an error. */
async function dropObject(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch (error) {
    console.error('[attachments] could not delete object', key, error);
  }
}

export async function requestUpload(
  ctx: WorkspaceContext,
  input: { taskId: string; fileName: string; contentType: string; size: number },
): Promise<Result<{ id: string; url: string; contentType: string }>> {
  return withAction(async () => {
    if (!storageEnabled()) return err(NOT_SET_UP);

    const parsed = z
      .object({
        taskId: z.string().min(1),
        fileName: z.string(),
        contentType: z.string(),
        size: z.number().int(),
      })
      .safeParse(input);
    if (!parsed.success) return err('Upload failed.');
    const { taskId, size } = parsed.data;
    if (size < 1 || size > MAX_ATTACHMENT_BYTES) return err('Files can be up to 25 MB.');

    const [owned] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!owned) return err('Task not found.');

    const id = newId();
    const key = attachmentKey(ctx.workspaceId, taskId, id);
    const contentType = normalizeContentType(parsed.data.contentType);
    await db.insert(attachment).values({
      id,
      workspaceId: ctx.workspaceId,
      taskId,
      // From the context, never the input.
      uploaderId: ctx.userId,
      key,
      fileName: sanitizeFileName(parsed.data.fileName),
      contentType,
      size,
    });

    const url = await presignPut({ key, contentType, size });
    return ok({ id, url, contentType });
  });
}

/** The caller's own pending row in this workspace. */
async function loadOwnPending(ctx: WorkspaceContext, attachmentId: string) {
  const [row] = await db
    .select()
    .from(attachment)
    .where(and(
      eq(attachment.id, attachmentId),
      eq(attachment.workspaceId, ctx.workspaceId),
      eq(attachment.uploaderId, ctx.userId),
      eq(attachment.status, 'pending'),
    ))
    .limit(1);
  return row ?? null;
}

export async function confirmUpload(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<AttachmentView>> {
  return withAction(async () => {
    const row = await loadOwnPending(ctx, input.attachmentId);
    if (!row) return err(UNFINISHED);

    const head = await headObject(row.key);
    if (!head) return err(UNFINISHED);
    if (head.size !== row.size) {
      await db.delete(attachment).where(eq(attachment.id, row.id));
      await dropObject(row.key);
      return err(UNFINISHED);
    }

    await db.transaction(async (tx) => {
      await tx.update(attachment).set({ status: 'ready' }).where(eq(attachment.id, row.id));
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_added', to: row.fileName }, tx);
    });

    const view = await getAttachmentView(ctx, row.id);
    return view ? ok(view) : err(UNFINISHED);
  });
}

export async function cancelUpload(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const row = await loadOwnPending(ctx, input.attachmentId);
    if (!row) return err(NOT_FOUND);

    await db.delete(attachment).where(eq(attachment.id, row.id));
    await dropObject(row.key);
    return ok(null);
  });
}

export async function deleteAttachment(
  ctx: WorkspaceContext,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const [row] = await db
      .select()
      .from(attachment)
      .where(and(
        eq(attachment.id, input.attachmentId),
        eq(attachment.workspaceId, ctx.workspaceId),
        eq(attachment.status, 'ready'),
      ))
      .limit(1);
    if (!row) return err(NOT_FOUND);

    // Same rule as comments: deletion is also a moderation tool.
    const canModerate = ctx.role === 'owner' || ctx.role === 'admin';
    if (row.uploaderId !== ctx.userId && !canModerate) {
      return err('You can only delete your own attachments.');
    }

    await db.transaction(async (tx) => {
      await tx.delete(attachment).where(eq(attachment.id, row.id));
      await recordActivity(ctx, { taskId: row.taskId, kind: 'attachment_removed', from: row.fileName }, tx);
    });
    // After commit: a rolled-back delete must not have lost the file.
    await dropObject(row.key);
    return ok(null);
  });
}
```

- [ ] **Step 5: Write `src/server/attachments/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/session';
import { withAction, type Result } from '@/lib/result';
import type { AttachmentView } from './queries';
import { cancelUpload, confirmUpload, deleteAttachment, requestUpload } from './service';

/**
 * Slug-taking wrappers only (Amendment A): every export here is a public HTTP
 * endpoint, so none of them may accept a caller-supplied WorkspaceContext.
 */

function revalidateWorkspace(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, 'layout');
}

export async function requestUploadAction(
  workspaceSlug: string,
  input: { taskId: string; fileName: string; contentType: string; size: number },
): Promise<Result<{ id: string; url: string; contentType: string }>> {
  return withAction(async () => requestUpload(await requireWorkspace(workspaceSlug), input));
}

export async function confirmUploadAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<AttachmentView>> {
  return withAction(async () => {
    const result = await confirmUpload(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}

export async function cancelUploadAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => cancelUpload(await requireWorkspace(workspaceSlug), input));
}

export async function deleteAttachmentAction(
  workspaceSlug: string,
  input: { attachmentId: string },
): Promise<Result<null>> {
  return withAction(async () => {
    const result = await deleteAttachment(await requireWorkspace(workspaceSlug), input);
    if (result.ok) revalidateWorkspace(workspaceSlug);
    return result;
  });
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `yarn vitest run tests/server/attachments.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/attachments tests/server/attachments.test.ts
git commit -m "feat(attachments): request, confirm, cancel and delete uploads"
```

---

### Task 5: Download route

**Files:**
- Create: `src/server/attachments/download.ts`, `src/app/api/attachments/[id]/route.ts`
- Test: `tests/server/attachment-download.test.ts`

**Interfaces:**
- Consumes: `presignGet`, `storageEnabled`, `isInlineType`, `contentDisposition`.
- Produces: `resolveDownload(userId: string, attachmentId: string, opts: { download: boolean }): Promise<string | null>` — presigned URL or null (not found / not a member / pending / storage off). Route: `GET /api/attachments/{id}[?download=1]`.

- [ ] **Step 1: Write the failing test `tests/server/attachment-download.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { confirmUpload, requestUpload } from '@/server/attachments/service';
import { resolveDownload } from '@/server/attachments/download';

beforeEach(async () => {
  await resetDb();
  await resetBucket();
});
afterAll(closeDb);

async function setup() {
  const ada = await createUser('dl@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-dl');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-dl', role: 'owner', timezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T' });
  if (!made.ok) throw new Error();
  return { ctx, ws, taskId: made.data.id };
}

async function upload(ctx: WorkspaceContext, taskId: string, fileName: string, contentType: string, confirm = true) {
  const body = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const req = await requestUpload(ctx, { taskId, fileName, contentType, size: body.length });
  if (!req.ok) throw new Error(req.error);
  await uploadTo(req.data.url, body, req.data.contentType);
  if (confirm) await confirmUpload(ctx, { attachmentId: req.data.id });
  return req.data.id;
}

describe('resolveDownload', () => {
  it('serves a png inline to a member', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'shot.png', 'image/png');

    const url = await resolveDownload(ctx.userId, id, { download: false });
    const res = await fetch(url!);

    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename="shot.png"/);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('forces attachment with ?download', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'shot.png', 'image/png');

    const res = await fetch((await resolveDownload(ctx.userId, id, { download: true }))!);

    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  // Review Focus 3.
  it('download of an svg is forced to attachment', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'logo.svg', 'image/svg+xml');

    const res = await fetch((await resolveDownload(ctx.userId, id, { download: false }))!);

    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('returns null for a pending upload', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png', false);
    expect(await resolveDownload(ctx.userId, id, { download: false })).toBeNull();
  });

  it('returns null for a member of another workspace', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png');
    const bob = await createUser('bob-dl@example.com');
    await createWorkspace(bob.id, 'Bob Co', 'bob-dl');

    expect(await resolveDownload(bob.id, id, { download: false })).toBeNull();
  });

  // Review Focus 4.
  it('404 once the user leaves the workspace', async () => {
    const { ctx, ws, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png');
    const grace = await createUser('grace-dl@example.com');
    const membership = await joinWorkspace(grace.id, ws.id, 'member');
    expect(await resolveDownload(grace.id, id, { download: false })).not.toBeNull();

    await membership.remove();

    expect(await resolveDownload(grace.id, id, { download: false })).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const { ctx } = await setup();
    expect(await resolveDownload(ctx.userId, 'nope', { download: false })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/server/attachment-download.test.ts`
Expected: FAIL — cannot resolve `@/server/attachments/download`.

- [ ] **Step 3: Write `src/server/attachments/download.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { attachment, db, member } from '@/db';
import { contentDisposition, isInlineType } from '@/lib/attachments';
import { presignGet, storageEnabled } from '@/lib/storage';

/**
 * A presigned GET for a ready attachment the user can see, else null. Resolved
 * by membership of the attachment's own workspace in the same query, so a
 * user removed from the workspace loses access at once, and "not yours" looks
 * exactly like "does not exist".
 */
export async function resolveDownload(
  userId: string,
  attachmentId: string,
  opts: { download: boolean },
): Promise<string | null> {
  if (!storageEnabled()) return null;

  const [row] = await db
    .select({ key: attachment.key, fileName: attachment.fileName, contentType: attachment.contentType })
    .from(attachment)
    .innerJoin(member, and(eq(member.organizationId, attachment.workspaceId), eq(member.userId, userId)))
    .where(and(eq(attachment.id, attachmentId), eq(attachment.status, 'ready')))
    .limit(1);
  if (!row) return null;

  const inline = !opts.download && isInlineType(row.contentType);
  return presignGet({
    key: row.key,
    // Anything not shown inline is served as opaque bytes, so the browser
    // never sniffs and renders it.
    contentType: inline ? row.contentType : 'application/octet-stream',
    disposition: contentDisposition(row.fileName, inline),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn vitest run tests/server/attachment-download.test.ts`
Expected: PASS.

- [ ] **Step 5: Read the route handler guide**, then write `src/app/api/attachments/[id]/route.ts`

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (the `RouteContext` section). Then:

```ts
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveDownload } from '@/server/attachments/download';

/**
 * Opens or downloads an attachment. Every hit re-checks the session and the
 * membership, then redirects to a five-minute presigned URL; the bucket
 * itself is never public.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/attachments/[id]'>) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;
  const download = request.nextUrl.searchParams.has('download');
  const url = await resolveDownload(session.user.id, id, { download });
  if (!url) return new Response('Not found', { status: 404 });

  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'private, no-store' },
  });
}
```

If `RouteContext<'/api/attachments/[id]'>` does not typecheck (types are generated by `next dev`/`next build`), run `yarn build` once or fall back to `{ params }: { params: Promise<{ id: string }> }`.

- [ ] **Step 6: Manual check**

```bash
yarn typecheck && yarn lint
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/attachments/nope   # with `yarn dev` running
```

Expected: `401` (no cookie).

- [ ] **Step 7: Commit**

```bash
git add src/server/attachments/download.ts src/app/api/attachments tests/server/attachment-download.test.ts
git commit -m "feat(attachments): member-only download route"
```

---

### Task 6: Orphan sweep

**Files:**
- Create: `src/server/attachments/sweep.ts`, `scripts/sweep-attachments.ts`
- Test: `tests/server/attachment-sweep.test.ts`

**Interfaces:**
- Consumes: `listKeys`, `deleteObjects`, `attachment` table.
- Produces: `sweepAttachments(opts: { dryRun: boolean; now?: Date }): Promise<{ staleRows: number; orphanObjects: number }>`

- [ ] **Step 1: Write the failing test `tests/server/attachment-sweep.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import { attachment } from '@/db';
import { headObject, presignPut } from '@/lib/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { confirmUpload, requestUpload } from '@/server/attachments/service';
import { sweepAttachments } from '@/server/attachments/sweep';

beforeEach(async () => {
  await resetDb();
  await resetBucket();
});
afterAll(closeDb);

const body = new TextEncoder().encode('x');

async function setup() {
  const ada = await createUser('sw@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-sw');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-sw', role: 'owner', timezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T' });
  if (!made.ok) throw new Error();
  return { ctx, taskId: made.data.id };
}

async function pending(ctx: WorkspaceContext, taskId: string) {
  const req = await requestUpload(ctx, { taskId, fileName: 'p.txt', contentType: 'text/plain', size: body.length });
  if (!req.ok) throw new Error();
  await uploadTo(req.data.url, body, 'text/plain');
  return req.data.id;
}

describe('sweepAttachments', () => {
  it('removes stale pending rows with their objects and objects with no row', async () => {
    const { ctx, taskId } = await setup();
    const stale = await pending(ctx, taskId);
    await db.update(attachment).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(attachment.id, stale));
    const fresh = await pending(ctx, taskId);
    const ready = await pending(ctx, taskId);
    await confirmUpload(ctx, { attachmentId: ready });
    const orphanKey = `ws/${ctx.workspaceId}/tasks/${taskId}/orphan`;
    await uploadTo(await presignPut({ key: orphanKey, contentType: 'text/plain', size: 1 }), body, 'text/plain');

    const result = await sweepAttachments({ dryRun: false });

    expect(result).toEqual({ staleRows: 1, orphanObjects: 2 });
    const ids = (await db.select({ id: attachment.id }).from(attachment)).map((r) => r.id).sort();
    expect(ids).toEqual([fresh, ready].sort());
    expect(await headObject(orphanKey)).toBeNull();
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${stale}`)).toBeNull();
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${fresh}`)).not.toBeNull();
  });

  it('deletes nothing on a dry run', async () => {
    const { ctx, taskId } = await setup();
    const stale = await pending(ctx, taskId);
    await db.update(attachment).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(attachment.id, stale));

    const result = await sweepAttachments({ dryRun: true });

    expect(result).toEqual({ staleRows: 1, orphanObjects: 1 });
    expect(await db.select().from(attachment)).toHaveLength(1);
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${stale}`)).not.toBeNull();
  });
});
```

`orphanObjects` counts every object deleted: the stale row's object plus the row-less one (2 in the first test, 1 in the dry run).

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/server/attachment-sweep.test.ts`
Expected: FAIL — cannot resolve `@/server/attachments/sweep`.

- [ ] **Step 3: Write `src/server/attachments/sweep.ts`**

```ts
import { and, eq, inArray, lt } from 'drizzle-orm';
import { attachment, db } from '@/db';
import { deleteObjects, listKeys } from '@/lib/storage';

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Objects outlive rows when an upload is never confirmed, a best-effort
 * delete fails, or a task/project/workspace delete cascades the rows away.
 * Stale pending rows go first, so their objects then count as row-less.
 */
export async function sweepAttachments(
  opts: { dryRun: boolean; now?: Date },
): Promise<{ staleRows: number; orphanObjects: number }> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - STALE_MS);
  const stale = await db
    .select({ id: attachment.id, key: attachment.key })
    .from(attachment)
    .where(and(eq(attachment.status, 'pending'), lt(attachment.createdAt, cutoff)));
  const staleKeys = new Set(stale.map((r) => r.key));

  const keys = await listKeys('ws/');
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const rows = await db.select({ key: attachment.key }).from(attachment).where(inArray(attachment.key, batch));
    for (const r of rows) if (!staleKeys.has(r.key)) known.add(r.key);
  }
  const orphans = keys.filter((k) => !known.has(k));

  if (!opts.dryRun) {
    if (stale.length) await db.delete(attachment).where(inArray(attachment.id, stale.map((r) => r.id)));
    if (orphans.length) await deleteObjects(orphans);
  }
  return { staleRows: stale.length, orphanObjects: orphans.length };
}
```

- [ ] **Step 4: Write `scripts/sweep-attachments.ts`**

```ts
import { config } from 'dotenv';

config({ path: process.env.SWEEP_ENV_FILE ?? '.env.local' });

/**
 * yarn attachments:sweep [--dry-run]
 * SWEEP_ENV_FILE=.env.production.local yarn attachments:sweep  — against production.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { sweepAttachments } = await import('../src/server/attachments/sweep');
  const { pool } = await import('../src/db');
  const result = await sweepAttachments({ dryRun });
  console.log(`${dryRun ? '[dry run] would remove' : 'removed'} ${result.staleRows} stale uploads, ${result.orphanObjects} objects`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`src/db` imports use the `@/` alias internally; if tsx cannot resolve `@/`, run with `tsx --tsconfig tsconfig.json` (tsx honours `paths`) — check `scripts/storage-init.ts` from Task 1 ran the same way.

- [ ] **Step 5: Run to verify it passes**

```bash
yarn vitest run tests/server/attachment-sweep.test.ts
yarn attachments:sweep --dry-run
```

Expected: tests PASS; the script prints a `[dry run]` line.

- [ ] **Step 6: Commit**

```bash
git add src/server/attachments/sweep.ts scripts/sweep-attachments.ts tests/server/attachment-sweep.test.ts package.json
git commit -m "feat(attachments): sweep stale uploads and orphaned objects"
```

---

### Task 7: Vendored AlignUI primitives

**Files:**
- Create: `src/components/ui/file-upload.tsx`, `src/components/ui/file-format-icon.tsx`, `src/components/ui/progress-bar.tsx`
- Modify: `tests/unit/vendored-ui.test.ts`

**Interfaces:**
- Produces: `FileUpload.Root` (label), `FileUpload.Button`, `FileUpload.Icon`; `FileFormatIcon.Root({ format, color, size })`; `ProgressBar.Root({ value, max, color })`.

- [ ] **Step 1: Extend the vendored list test** — in `tests/unit/vendored-ui.test.ts`, add `'file-upload.tsx', 'file-format-icon.tsx', 'progress-bar.tsx'` to the `arrayContaining` list.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/unit/vendored-ui.test.ts`
Expected: FAIL on `exist`.

- [ ] **Step 3: Write `src/components/ui/file-upload.tsx`** (AlignUI source, unchanged except imports)

```tsx
// AlignUI FileUpload v0.0.0

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/utils/cn';
import type { PolymorphicComponentProps } from '@/utils/polymorphic';

const FileUpload = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & {
    asChild?: boolean;
  }
>(({ className, asChild, ...rest }, forwardedRef) => {
  const Component = asChild ? Slot : 'label';

  return (
    <Component
      ref={forwardedRef}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center gap-5 rounded-xl border border-dashed border-stroke-sub-300 bg-bg-white-0 p-8 text-center',
        'transition duration-200 ease-out',
        // hover
        'hover:bg-bg-weak-50',
        className,
      )}
      {...rest}
    />
  );
});
FileUpload.displayName = 'FileUpload';

const FileUploadButton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean;
  }
>(({ className, asChild, ...rest }, forwardedRef) => {
  const Component = asChild ? Slot : 'div';

  return (
    <Component
      ref={forwardedRef}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-2.5 whitespace-nowrap rounded-lg bg-bg-white-0 px-2.5 text-label-sm text-text-sub-600',
        'pointer-events-none ring-1 ring-inset ring-stroke-soft-200',
        className,
      )}
      {...rest}
    />
  );
});
FileUploadButton.displayName = 'FileUploadButton';

function FileUploadIcon<T extends React.ElementType>({
  className,
  as,
  ...rest
}: PolymorphicComponentProps<T>) {
  const Component = as || 'div';

  return <Component className={cn('size-6 text-text-sub-600', className)} {...rest} />;
}

export { FileUpload as Root, FileUploadButton as Button, FileUploadIcon as Icon };
```

This imports `@radix-ui/react-slot`, so the vendored test requires `'use client';` — add it after the header comment exactly as other files do (`// AlignUI FileUpload v0.0.0\n\n'use client';`).

- [ ] **Step 4: Write `src/components/ui/file-format-icon.tsx`**

```tsx
// AlignUI FileFormatIcon v0.0.0

import * as React from 'react';
import { tv, type VariantProps } from '@/utils/tv';

export const fileFormatIconVariants = tv({
  slots: {
    root: 'relative shrink-0',
    formatBox:
      'absolute bottom-1.5 left-0 flex h-4 items-center rounded px-[3px] py-0.5 text-[11px] font-semibold leading-none text-static-white',
  },
  variants: {
    size: {
      medium: { root: 'size-10' },
      small: { root: 'size-8' },
    },
    color: {
      red: { formatBox: 'bg-error-base' },
      orange: { formatBox: 'bg-warning-base' },
      yellow: { formatBox: 'bg-away-base' },
      green: { formatBox: 'bg-success-base' },
      sky: { formatBox: 'bg-verified-base' },
      blue: { formatBox: 'bg-information-base' },
      purple: { formatBox: 'bg-feature-base' },
      pink: { formatBox: 'bg-highlighted-base' },
      gray: { formatBox: 'bg-faded-base' },
    },
  },
  defaultVariants: { color: 'gray', size: 'medium' },
});

function FileFormatIcon({
  format,
  className,
  color,
  size,
  ...rest
}: VariantProps<typeof fileFormatIconVariants> &
  Omit<React.SVGProps<SVGSVGElement>, 'color'> & { format: string }) {
  const { root, formatBox } = fileFormatIconVariants({ color, size });

  return (
    <svg
      width='40'
      height='40'
      viewBox='0 0 40 40'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={root({ class: className })}
      {...rest}
    >
      <path
        d='M30 39.25H10C7.10051 39.25 4.75 36.8995 4.75 34V6C4.75 3.10051 7.10051 0.75 10 0.75H20.5147C21.9071 0.75 23.2425 1.30312 24.227 2.28769L33.7123 11.773C34.6969 12.7575 35.25 14.0929 35.25 15.4853V34C35.25 36.8995 32.8995 39.25 30 39.25Z'
        className='fill-bg-white-0 stroke-stroke-sub-300'
        strokeWidth='1.5'
      />
      <path d='M23 1V9C23 11.2091 24.7909 13 27 13H35' className='stroke-stroke-sub-300' strokeWidth='1.5' />
      <foreignObject x='0' y='0' width='40' height='40'>
        <div className={formatBox()}>{format}</div>
      </foreignObject>
    </svg>
  );
}

export { FileFormatIcon as Root };
```

(Upstream puts `xmlns` on the inner div; React warns about it, so it is dropped. `Omit<..., 'color'>` avoids the SVG `color` prop clashing with the variant.)

Check `bg-highlighted-base` exists: `grep -n "highlighted-base" src/styles/align-tokens.css`. If not, delete the `pink` variant line.

- [ ] **Step 5: Write `src/components/ui/progress-bar.tsx`**

```tsx
// AlignUI ProgressBar v0.0.0

import * as React from 'react';
import { tv, type VariantProps } from '@/utils/tv';

export const progressBarVariants = tv({
  slots: {
    root: 'h-1.5 w-full rounded-full bg-bg-soft-200',
    progress: 'h-full rounded-full transition-all duration-300 ease-out',
  },
  variants: {
    color: {
      blue: { progress: 'bg-information-base' },
      red: { progress: 'bg-error-base' },
      orange: { progress: 'bg-warning-base' },
      green: { progress: 'bg-success-base' },
    },
  },
  defaultVariants: { color: 'blue' },
});

type ProgressBarRootProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> &
  VariantProps<typeof progressBarVariants> & {
    value?: number;
    max?: number;
  };

const ProgressBarRoot = React.forwardRef<HTMLDivElement, ProgressBarRootProps>(
  ({ className, color, value = 0, max = 100, ...rest }, forwardedRef) => {
    const { root, progress } = progressBarVariants({ color });
    const safeValue = Math.min(max, Math.max(value, 0));

    return (
      <div ref={forwardedRef} className={root({ class: className })} {...rest}>
        <div
          className={progress()}
          style={{ width: `${(safeValue / max) * 100}%` }}
          aria-valuenow={value}
          aria-valuemax={max}
          role='progressbar'
        />
      </div>
    );
  },
);
ProgressBarRoot.displayName = 'ProgressBarRoot';

export { ProgressBarRoot as Root };
```

- [ ] **Step 6: Run to verify**

Run: `yarn vitest run tests/unit/vendored-ui.test.ts tests/unit/ui-dependencies.test.ts && yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/file-upload.tsx src/components/ui/file-format-icon.tsx src/components/ui/progress-bar.tsx tests/unit/vendored-ui.test.ts
git commit -m "feat(ui): vendor AlignUI file upload, file format icon and progress bar"
```

---

### Task 8: Upload queue (pure state + client runner)

**Files:**
- Create: `src/lib/upload-queue.ts`, `src/components/task/use-attachment-uploads.ts`
- Test: `tests/unit/upload-queue.test.ts`

**Interfaces:**
- Produces (`src/lib/upload-queue.ts`):
  ```ts
  export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';
  export type UploadItem = {
    localId: string; file: File; state: UploadState; loaded: number;
    error: string | null; retryable: boolean; attachmentId: string | null;
  };
  export const MAX_PARALLEL = 3;
  export function enqueue(items: UploadItem[], files: File[], makeId: () => string): UploadItem[];
  export function startable(items: UploadItem[]): UploadItem[];   // queued items that fit under MAX_PARALLEL, in order
  export function patchItem(items: UploadItem[], localId: string, patch: Partial<UploadItem>): UploadItem[];
  export function removeItem(items: UploadItem[], localId: string): UploadItem[];
  ```
- Produces (`use-attachment-uploads.ts`):
  ```ts
  export function useAttachmentUploads(workspaceSlug: string, taskId: string): {
    items: UploadItem[];
    add(files: File[]): void;
    cancel(localId: string): void;   // aborts an upload, or drops a queued/failed item
    retry(localId: string): void;
    remove(localId: string): Promise<void>; // deletes a completed upload's attachment, then drops it
  };
  ```

- [ ] **Step 1: Write the failing test `tests/unit/upload-queue.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { enqueue, patchItem, removeItem, startable, type UploadItem } from '@/lib/upload-queue';

let n = 0;
const makeId = () => `local-${++n}`;
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'text/plain' });

describe('enqueue', () => {
  it('queues valid files and fails oversize or empty ones immediately', () => {
    const big = file('big.bin', 1);
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });

    const items = enqueue([], [file('a.txt'), big, file('empty.txt', 0)], makeId);

    expect(items.map((i) => [i.file.name, i.state, i.error, i.retryable])).toEqual([
      ['a.txt', 'queued', null, false],
      ['big.bin', 'failed', 'Files can be up to 25 MB.', false],
      ['empty.txt', 'failed', 'Files can be up to 25 MB.', false],
    ]);
  });

  it('appends after existing items', () => {
    const first = enqueue([], [file('a.txt')], makeId);
    const both = enqueue(first, [file('b.txt')], makeId);
    expect(both.map((i) => i.file.name)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('startable', () => {
  it('fills free slots up to three in order', () => {
    let items = enqueue([], ['1', '2', '3', '4', '5'].map((x) => file(x)), makeId);
    items = patchItem(items, items[0].localId, { state: 'uploading' });

    expect(startable(items).map((i) => i.file.name)).toEqual(['2', '3']);
  });

  it('returns nothing when three are running', () => {
    let items = enqueue([], ['1', '2', '3', '4'].map((x) => file(x)), makeId);
    for (const i of items.slice(0, 3)) items = patchItem(items, i.localId, { state: 'uploading' });
    expect(startable(items)).toEqual([]);
  });
});

describe('patchItem / removeItem', () => {
  it('changes one item and leaves the others', () => {
    const items = enqueue([], [file('a'), file('b')], makeId);
    const next = patchItem(items, items[1].localId, { loaded: 5 });
    expect(next[0]).toBe(items[0]);
    expect(next[1].loaded).toBe(5);
    expect(removeItem(next, items[0].localId).map((i: UploadItem) => i.file.name)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/unit/upload-queue.test.ts`
Expected: FAIL — cannot resolve `@/lib/upload-queue`.

- [ ] **Step 3: Write `src/lib/upload-queue.ts`**

```ts
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';

/**
 * The upload queue as plain data, so its rules are tested without a browser.
 * The hook in components/task/use-attachment-uploads.ts owns the side effects.
 */

export type UploadState = 'queued' | 'uploading' | 'done' | 'failed';

export type UploadItem = {
  localId: string;
  file: File;
  state: UploadState;
  loaded: number;
  error: string | null;
  /** False for failures a retry cannot fix, such as a file over the limit. */
  retryable: boolean;
  attachmentId: string | null;
};

export const MAX_PARALLEL = 3;

export function enqueue(items: UploadItem[], files: File[], makeId: () => string): UploadItem[] {
  const added = files.map((file): UploadItem => {
    const tooBig = file.size < 1 || file.size > MAX_ATTACHMENT_BYTES;
    return {
      localId: makeId(),
      file,
      state: tooBig ? 'failed' : 'queued',
      loaded: 0,
      error: tooBig ? 'Files can be up to 25 MB.' : null,
      retryable: false,
      attachmentId: null,
    };
  });
  return [...items, ...added];
}

export function startable(items: UploadItem[]): UploadItem[] {
  const running = items.filter((i) => i.state === 'uploading').length;
  return items.filter((i) => i.state === 'queued').slice(0, Math.max(0, MAX_PARALLEL - running));
}

export function patchItem(items: UploadItem[], localId: string, patch: Partial<UploadItem>): UploadItem[] {
  return items.map((i) => (i.localId === localId ? { ...i, ...patch } : i));
}

export function removeItem(items: UploadItem[], localId: string): UploadItem[] {
  return items.filter((i) => i.localId !== localId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn vitest run tests/unit/upload-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/components/task/use-attachment-uploads.ts`**

```ts
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  enqueue, patchItem, removeItem, startable, type UploadItem,
} from '@/lib/upload-queue';
import {
  cancelUploadAction, confirmUploadAction, deleteAttachmentAction, requestUploadAction,
} from '@/server/attachments/actions';

/**
 * One queue per task, kept at module level so the section and the upload
 * modal share it, and closing the modal (or the task dialog) never stops a
 * running upload.
 */
type Store = {
  items: UploadItem[];
  listeners: Set<() => void>;
  xhrs: Map<string, XMLHttpRequest>;
  /** Whether the modal is open; failures toast only when it is not. */
  modalOpen: boolean;
};

const stores = new Map<string, Store>();
const EMPTY: UploadItem[] = [];

function storeFor(taskId: string): Store {
  let store = stores.get(taskId);
  if (!store) {
    store = { items: [], listeners: new Set(), xhrs: new Map(), modalOpen: false };
    stores.set(taskId, store);
  }
  return store;
}

function update(store: Store, next: UploadItem[]) {
  store.items = next;
  for (const listener of store.listeners) listener();
}

export function setUploadModalOpen(taskId: string, open: boolean) {
  storeFor(taskId).modalOpen = open;
}

function putFile(url: string, file: File, contentType: string, onProgress: (loaded: number) => void, onXhr: (x: XMLHttpRequest) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr(xhr);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.send(file);
  });
}

export function useAttachmentUploads(workspaceSlug: string, taskId: string) {
  const router = useRouter();
  const store = storeFor(taskId);

  const items = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.items,
    () => EMPTY,
  );

  const pump = useCallback(() => {
    for (const item of startable(store.items)) void run(item);

    async function run(item: UploadItem) {
      update(store, patchItem(store.items, item.localId, { state: 'uploading', loaded: 0, error: null }));
      // ✕ removes the item at once, even while an await below is pending; each
      // step checks, so a cancelled upload never goes on to confirm.
      const gone = () => !store.items.some((i) => i.localId === item.localId);
      const fail = (error: string, retryable: boolean) => {
        update(store, patchItem(store.items, item.localId, { state: 'failed', error, retryable }));
        if (!store.modalOpen) toast.error(`${item.file.name}: ${error}`);
      };

      const req = await requestUploadAction(workspaceSlug, {
        taskId, fileName: item.file.name, contentType: item.file.type, size: item.file.size,
      });
      if (!req.ok) {
        if (!gone()) fail(req.error, req.error === 'Upload failed.' || req.error.startsWith('Something went wrong'));
        return pump();
      }
      if (gone()) {
        void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
        return pump();
      }
      update(store, patchItem(store.items, item.localId, { attachmentId: req.data.id }));

      try {
        await putFile(
          req.data.url, item.file, req.data.contentType,
          (loaded) => update(store, patchItem(store.items, item.localId, { loaded })),
          (xhr) => store.xhrs.set(item.localId, xhr),
        );
      } catch (error) {
        store.xhrs.delete(item.localId);
        void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
        // A cancel already removed the item; nothing left to mark.
        if (!(error instanceof DOMException && error.name === 'AbortError')) fail('Upload failed.', true);
        return pump();
      }
      store.xhrs.delete(item.localId);
      if (gone()) {
        void cancelUploadAction(workspaceSlug, { attachmentId: req.data.id });
        return pump();
      }

      const done = await confirmUploadAction(workspaceSlug, { attachmentId: req.data.id });
      if (!done.ok) fail(done.error, true);
      else {
        update(store, patchItem(store.items, item.localId, { state: 'done', loaded: item.file.size }));
        router.refresh();
      }
      pump();
    }
  }, [router, store, taskId, workspaceSlug]);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    update(store, enqueue(store.items, files, () => crypto.randomUUID()));
    pump();
  }, [pump, store]);

  const cancel = useCallback((localId: string) => {
    store.xhrs.get(localId)?.abort();
    update(store, removeItem(store.items, localId));
    pump();
  }, [pump, store]);

  const retry = useCallback((localId: string) => {
    update(store, patchItem(store.items, localId, { state: 'queued', error: null, attachmentId: null, loaded: 0 }));
    pump();
  }, [pump, store]);

  const remove = useCallback(async (localId: string) => {
    const item = store.items.find((i) => i.localId === localId);
    if (item?.attachmentId) {
      const result = await deleteAttachmentAction(workspaceSlug, { attachmentId: item.attachmentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    }
    update(store, removeItem(store.items, localId));
  }, [router, store, workspaceSlug]);

  return { items, add, cancel, retry, remove };
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: clean. (The hook is exercised end-to-end in Task 10.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/upload-queue.ts src/components/task/use-attachment-uploads.ts tests/unit/upload-queue.test.ts
git commit -m "feat(attachments): client upload queue with progress and retry"
```

---

### Task 9: Attachment UI in the task detail

**Files:**
- Create: `src/components/task/AttachmentCard.tsx`, `src/components/task/AttachmentUploadModal.tsx`, `src/components/task/AttachmentSection.tsx`
- Modify: `src/components/task/TaskDetailView.tsx`, `src/components/task/ProjectTaskDialog.tsx`, `src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx`

**Interfaces:**
- Consumes: `AttachmentView`, `listTaskAttachments`, `storageEnabled`, `useAttachmentUploads`, `setUploadModalOpen`, `fileFormat`, `formatBytes`, `isInlineType`, `formatInZone(date, tz)`, `useConfirm()`, vendored UI from Task 7.
- Produces: `TaskDetailViewProps.attachments: AttachmentView[] | null` (null = storage off → section hidden).

- [ ] **Step 1: Write `src/components/task/AttachmentCard.tsx`**

```tsx
'use client';

import {
  IconAlertCircleFilled, IconCircleCheckFilled, IconDownload, IconLoader2, IconTrash, IconX,
} from '@tabler/icons-react';
import * as CompactButton from '@/components/ui/compact-button';
import * as FileFormatIcon from '@/components/ui/file-format-icon';
import * as ProgressBar from '@/components/ui/progress-bar';
import { fileFormat, formatBytes, isInlineType } from '@/lib/attachments';
import type { UploadItem } from '@/lib/upload-queue';
import { cn } from '@/utils/cn';

function FileGlyph({ fileName, contentType, thumbnail }: { fileName: string; contentType: string; thumbnail?: string }) {
  if (thumbnail && isInlineType(contentType) && contentType.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- presigned bucket URLs, not optimisable
      <img src={thumbnail} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-stroke-soft-200" />
    );
  }
  const { label, color } = fileFormat(fileName, contentType);
  return <FileFormatIcon.Root format={label} color={color} />;
}

/** A saved attachment (File Upload 01, "completed"). */
export function ReadyAttachmentCard({
  id, fileName, contentType, size, meta, canDelete, onDelete,
}: {
  id: string; fileName: string; contentType: string; size: number; meta: string;
  canDelete: boolean; onDelete: () => void;
}) {
  const href = `/api/attachments/${id}`;
  return (
    <li className="group relative flex items-center gap-3 rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset ring-stroke-soft-200 transition-colors duration-150 hover:bg-bg-weak-50">
      <FileGlyph fileName={fileName} contentType={contentType} thumbnail={href} />
      <div className="min-w-0 flex-1">
        {/* The stretched link makes the whole card open the file. */}
        <a href={href} target="_blank" rel="noopener" className="block truncate text-label-sm text-text-strong-950 after:absolute after:inset-0">
          {fileName}
        </a>
        <p className="truncate text-paragraph-xs text-text-sub-600">{formatBytes(size)} · {meta}</p>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        <CompactButton.Root variant="ghost" size="large" asChild>
          <a href={`${href}?download=1`} aria-label={`Download ${fileName}`}>
            <CompactButton.Icon as={IconDownload} aria-hidden="true" />
          </a>
        </CompactButton.Root>
        {canDelete && (
          <CompactButton.Root variant="ghost" size="large" onClick={onDelete} aria-label={`Delete ${fileName}`}>
            <CompactButton.Icon as={IconTrash} aria-hidden="true" />
          </CompactButton.Root>
        )}
      </div>
    </li>
  );
}

/** An upload in this session (File Upload 01, uploading / completed / failed). */
export function UploadCard({
  item, onCancel, onRetry, onRemove,
}: {
  item: UploadItem; onCancel: () => void; onRetry: () => void; onRemove: () => void;
}) {
  const { file, state } = item;
  const failed = state === 'failed';
  return (
    <li className={cn(
      'flex flex-col gap-3 rounded-2xl bg-bg-white-0 p-4 ring-1 ring-inset',
      failed ? 'ring-error-base' : 'ring-stroke-soft-200',
    )}>
      <div className="flex items-start gap-3">
        <FileGlyph fileName={file.name} contentType={file.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-sm text-text-strong-950">{file.name}</p>
          <p className="flex items-center gap-1 text-paragraph-xs text-text-sub-600">
            <span className="tabular">
              {state === 'uploading' ? `${formatBytes(item.loaded)} of ${formatBytes(file.size)}` : formatBytes(file.size)}
            </span>
            <span aria-hidden="true">·</span>
            {state === 'queued' && <span>Queued</span>}
            {state === 'uploading' && (
              <><IconLoader2 className="size-4 animate-spin text-information-base" aria-hidden="true" /> Uploading…</>
            )}
            {state === 'done' && (
              <><IconCircleCheckFilled className="size-4 text-success-base" aria-hidden="true" /> Completed</>
            )}
            {failed && (
              <><IconAlertCircleFilled className="size-4 text-error-base" aria-hidden="true" /> {item.error ?? 'Upload failed.'}</>
            )}
          </p>
          {failed && item.retryable && (
            <button type="button" onClick={onRetry} className="mt-2 text-label-sm text-error-base underline underline-offset-2">
              Try Again
            </button>
          )}
        </div>
        {state === 'done' ? (
          <CompactButton.Root variant="ghost" size="large" onClick={onRemove} aria-label={`Delete ${file.name}`}>
            <CompactButton.Icon as={IconTrash} aria-hidden="true" />
          </CompactButton.Root>
        ) : failed ? (
          <CompactButton.Root variant="ghost" size="large" onClick={onCancel} aria-label={`Dismiss ${file.name}`}>
            <CompactButton.Icon as={IconTrash} className="text-error-base" aria-hidden="true" />
          </CompactButton.Root>
        ) : (
          <CompactButton.Root variant="ghost" size="large" onClick={onCancel} aria-label={`Cancel ${file.name}`}>
            <CompactButton.Icon as={IconX} aria-hidden="true" />
          </CompactButton.Root>
        )}
      </div>
      {state === 'uploading' && (
        <ProgressBar.Root value={item.loaded} max={file.size} aria-label={`Uploading ${file.name}`} />
      )}
    </li>
  );
}
```

Check `IconLoader2`, `IconAlertCircleFilled`, `IconCircleCheckFilled`, `IconDownload`, `IconCloudUpload` exist in `@tabler/icons-react` 3.48 (`node -e "const t=require('@tabler/icons-react');console.log(['IconLoader2','IconAlertCircleFilled','IconCircleCheckFilled','IconDownload','IconCloudUpload'].map(n=>n+':'+!!t[n]))"`).

- [ ] **Step 2: Write `src/components/task/AttachmentUploadModal.tsx`**

```tsx
'use client';

import { IconCloudUpload } from '@tabler/icons-react';
import { useEffect, useId } from 'react';
import { UploadCard } from '@/components/task/AttachmentCard';
import { setUploadModalOpen, type useAttachmentUploads } from '@/components/task/use-attachment-uploads';
import * as FileUpload from '@/components/ui/file-upload';
import * as Modal from '@/components/ui/modal';

type Uploads = ReturnType<typeof useAttachmentUploads>;

/** AlignUI Pro "File Upload 03": header, dashed dropzone, per-file cards. */
export function AttachmentUploadModal({
  taskId, open, onOpenChange, uploads,
}: {
  taskId: string; open: boolean; onOpenChange: (open: boolean) => void; uploads: Uploads;
}) {
  const inputId = useId();

  useEffect(() => {
    setUploadModalOpen(taskId, open);
    return () => setUploadModalOpen(taskId, false);
  }, [open, taskId]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-[440px]">
        <Modal.Header
          icon={IconCloudUpload}
          title="Upload files"
          description="Attach files to this task"
        />
        <Modal.Body className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <FileUpload.Root
            htmlFor={inputId}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              uploads.add(Array.from(e.dataTransfer.files));
            }}
          >
            <input
              id={inputId}
              type="file"
              multiple
              className="sr-only"
              aria-label="Choose files to attach"
              onChange={(e) => {
                uploads.add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <FileUpload.Icon as={IconCloudUpload} />
            <div className="space-y-1.5">
              <div className="text-label-sm text-text-strong-950">Choose a file or drag &amp; drop it here</div>
              <div className="text-paragraph-xs text-text-sub-600">Any file type, up to 25 MB.</div>
            </div>
            <FileUpload.Button>Browse File</FileUpload.Button>
          </FileUpload.Root>

          {uploads.items.length > 0 && (
            <ul className="flex flex-col gap-3" aria-label="Uploads">
              {uploads.items.map((item) => (
                <UploadCard
                  key={item.localId}
                  item={item}
                  onCancel={() => uploads.cancel(item.localId)}
                  onRetry={() => uploads.retry(item.localId)}
                  onRemove={() => void uploads.remove(item.localId)}
                />
              ))}
            </ul>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
```

Before relying on `Modal.Header`'s `icon`/`title`/`description` props, read `src/components/ui/modal.tsx` lines 80-180 (`ModalHeader`, `ModalBody`). If `ModalHeader` takes different props, compose it from its children the way `src/components/ui/confirm-dialog.tsx` does. The modal renders its own close button (`showClose` defaults true).

A focus ring for the dropzone: the hidden input takes focus, so add `has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-base` to `FileUpload.Root`'s `className`.

- [ ] **Step 3: Write `src/components/task/AttachmentSection.tsx`**

```tsx
'use client';

import { IconPaperclip } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReadyAttachmentCard, UploadCard } from '@/components/task/AttachmentCard';
import { AttachmentUploadModal } from '@/components/task/AttachmentUploadModal';
import { useAttachmentUploads } from '@/components/task/use-attachment-uploads';
import * as Button from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatInZone } from '@/lib/dates';
import type { AttachmentView } from '@/server/attachments/queries';
import { deleteAttachmentAction } from '@/server/attachments/actions';
import { cn } from '@/utils/cn';

export function AttachmentSection({
  taskId, attachments, workspaceSlug, currentUserId, canModerate, timezone,
}: {
  taskId: string;
  attachments: AttachmentView[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const uploads = useAttachmentUploads(workspaceSlug, taskId);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Completed uploads appear in `attachments` after the refresh, so the
  // section only shows the ones still in flight or failed.
  const active = uploads.items.filter((i) => i.state !== 'done');

  async function onDelete(a: AttachmentView) {
    const ok = await confirm({ title: `Delete "${a.fileName}"?`, description: 'It can’t be undone.' });
    if (!ok) return;
    const result = await deleteAttachmentAction(workspaceSlug, { attachmentId: a.id });
    if (!result.ok) toast.error(result.error);
    router.refresh();
  }

  return (
    <section
      aria-labelledby={`attachments-${taskId}`}
      className={cn('flex flex-col gap-2 rounded-2xl transition-shadow', dragging && 'ring-2 ring-primary-base ring-offset-4 ring-offset-bg-white-0')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        uploads.add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center justify-between">
        <h2 id={`attachments-${taskId}`} className="text-label-sm text-text-strong-950">
          Attachments
          {attachments.length > 0 && (
            <span className="tabular ml-1.5 text-paragraph-xs text-text-sub-600">{attachments.length}</span>
          )}
        </h2>
        <Button.Root type="button" variant="neutral" mode="stroke" size="xsmall" onClick={() => setModalOpen(true)}>
          <Button.Icon as={IconPaperclip} />
          Attach files
        </Button.Root>
      </div>

      {attachments.length === 0 && active.length === 0 ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-xl border border-dashed border-stroke-sub-300 px-4 py-5 text-center text-paragraph-xs text-text-sub-600 transition-colors duration-150 hover:bg-bg-weak-50"
        >
          <span className="text-label-sm text-text-strong-950">Drop files here or browse</span>
          <br />
          Any file type, up to 25 MB.
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Attachments">
          {active.map((item) => (
            <UploadCard
              key={item.localId}
              item={item}
              onCancel={() => uploads.cancel(item.localId)}
              onRetry={() => uploads.retry(item.localId)}
              onRemove={() => void uploads.remove(item.localId)}
            />
          ))}
          {attachments.map((a) => (
            <ReadyAttachmentCard
              key={a.id}
              id={a.id}
              fileName={a.fileName}
              contentType={a.contentType}
              size={a.size}
              meta={`${a.uploaderName} · ${formatInZone(a.createdAt, timezone)}`}
              canDelete={a.uploaderId === currentUserId || canModerate}
              onDelete={() => void onDelete(a)}
            />
          ))}
        </ul>
      )}

      <AttachmentUploadModal taskId={taskId} open={modalOpen} onOpenChange={setModalOpen} uploads={uploads} />
    </section>
  );
}
```

Check `ring-primary-base` exists in `src/styles/align-tokens.css` (`grep -n "primary-base" src/styles/align-tokens.css | head -2`).

- [ ] **Step 4: Wire into `TaskDetailView.tsx`**

Add import:

```tsx
import { AttachmentSection } from '@/components/task/AttachmentSection';
import type { AttachmentView } from '@/server/attachments/queries';
```

Add to `TaskDetailViewProps`:

```ts
  /** Null when storage is not configured; the section is then hidden. */
  attachments: AttachmentView[] | null;
```

Destructure `attachments` in the component's parameter list, and render between the `SubtaskSection` block and `<ActivityFeed`:

```tsx
          {attachments && (
            <AttachmentSection
              taskId={task.id}
              attachments={attachments}
              workspaceSlug={workspaceSlug}
              currentUserId={currentUserId}
              canModerate={canModerate}
              timezone={timezone}
            />
          )}
```

- [ ] **Step 5: Load attachments in both callers**

In `src/components/task/ProjectTaskDialog.tsx` add imports:

```ts
import { storageEnabled } from '@/lib/storage';
import { listTaskAttachments } from '@/server/attachments/queries';
```

Change the `Promise.all` and pass the prop:

```ts
  const [members, allLabels, feed, attachments] = await Promise.all([
    listWorkspaceMembers(ctx), listLabels(ctx), listTaskFeed(ctx, task.id),
    storageEnabled() ? listTaskAttachments(ctx, task.id) : null,
  ]);
```

```tsx
      attachments={attachments}
```

Do the same in `src/app/(app)/[workspaceSlug]/tasks/[taskId]/page.tsx`:

```ts
  const [project, members, allLabels, feed, attachments] = await Promise.all([
    getProject(ctx, task.projectId),
    listWorkspaceMembers(ctx),
    listLabels(ctx),
    listTaskFeed(ctx, task.id),
    storageEnabled() ? listTaskAttachments(ctx, task.id) : null,
  ]);
```

and `attachments={attachments}` on `<TaskDetailView>`.

- [ ] **Step 6: Check it in the browser**

```bash
yarn typecheck && yarn lint && yarn test
yarn dev
```

Open a task (both the `?task=` dialog and `/[slug]/tasks/[id]`), then:
1. Empty state shows; "Attach files" opens the modal.
2. Pick 5 files incl. one > 25 MB: big one fails at once without "Try Again"; others show progress, at most 3 uploading.
3. ✕ on an uploading file removes it; no row remains (`psql` or it never shows after reload).
4. Close modal mid-upload: section shows the in-progress card; it completes and moves to the list.
5. Image shows a thumbnail; clicking a PDF opens it in a new tab; clicking a `.html` file downloads it.
6. Delete asks to confirm, then the card disappears and History shows "removed attachment “…”".
7. Phone width (375 px): single column, no horizontal scroll.
8. Dark mode: cards, dropzone and badges readable.

- [ ] **Step 7: Commit**

```bash
git add src/components/task src/app
git commit -m "feat(attachments): attachments section and upload modal on the task detail"
```

---

### Task 10: E2E coverage and README

**Files:**
- Create: `tests/e2e/attachments.spec.ts`
- Modify: `playwright.config.ts`, `README.md`

**Interfaces:**
- Consumes: the UI from Task 9 (button "Attach files", input labelled "Choose files to attach", card links named by file name, buttons `Delete <name>`), `createTask` helper.

- [ ] **Step 1: Point the e2e server at the test bucket** — in `playwright.config.ts` `webServer.env` add:

```ts
      S3_BUCKET: process.env.S3_BUCKET_TEST!,
```

- [ ] **Step 2: Write `tests/e2e/attachments.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { createTask } from './tasks';

async function signUpWithTask(page: Page) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/auth/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Attachment Tester');
  await page.getByLabel('Email', { exact: true }).fill(`attach-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await page.getByLabel('Workspace name').fill(`Attach ${stamp}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Website');
  await page.getByRole('button', { name: 'Create project' }).click();

  await createTask(page, 'Needs files');
}

test('attach a file, see it after reload, open it, delete it', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Task details' });

  await details.getByRole('button', { name: 'Attach files' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload files' });
  await upload.getByLabel('Choose files to attach').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello attachments'),
  });
  await expect(upload.getByText('Completed')).toBeVisible();
  await upload.getByRole('button', { name: 'Close' }).click();

  await page.reload();
  const card = page.getByRole('link', { name: 'notes.txt' });
  await expect(card).toBeVisible();
  await expect(page.getByText('attached “notes.txt”')).toBeVisible();

  // The download link redirects to the bucket with the file as an attachment.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download notes.txt' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('notes.txt');

  await page.getByRole('button', { name: 'Delete notes.txt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText('removed attachment “notes.txt”')).toBeVisible();
});

test('a file over 25 MB fails without uploading', async ({ page }) => {
  await signUpWithTask(page);
  await page.getByRole('button', { name: 'Needs files', exact: true }).click();
  await page.getByRole('button', { name: 'Attach files' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload files' });

  await upload.getByLabel('Choose files to attach').setInputFiles({
    name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
  });

  await expect(upload.getByText('Files can be up to 25 MB.')).toBeVisible();
  await expect(upload.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
});
```

If the modal's title is not exposed as its accessible name, give `Modal.Content` `aria-labelledby` pointing at the title id, or fall back to `page.getByRole('dialog').filter({ hasText: 'Upload files' })`.

- [ ] **Step 3: Run**

```bash
yarn e2e tests/e2e/attachments.spec.ts
```

Expected: 2 passing. Then run the whole suite once: `yarn e2e` — all specs still pass.

- [ ] **Step 4: README** — under "## Deploy on Vercel" › "### 2. Environment variables", add rows:

```markdown
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | R2 bucket name, or empty to turn attachments off |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token (Object Read & Write, this bucket only) |
```

and a new subsection after it:

```markdown
### Attachments on Cloudflare R2

1. R2 → **Create bucket**. Leave public access off; the app only ever hands out five-minute signed links.
2. R2 → **Manage API tokens** → create a token with **Object Read & Write** scoped to that bucket. Its access key id and secret go in `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
3. Bucket → **Settings → CORS policy**, so browsers can upload straight to the bucket:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.example.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Uploads that never finish and files of deleted tasks stay in the bucket until swept:
   `SWEEP_ENV_FILE=.env.production.local yarn attachments:sweep` (add `--dry-run` to preview). Run it daily or weekly.

Locally, `yarn db:up` also starts MinIO; run `yarn storage:init` once to create the buckets.
```

- [ ] **Step 5: Final checks**

```bash
yarn typecheck && yarn lint && yarn test && yarn build
graphify update .
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/attachments.spec.ts playwright.config.ts README.md graphify-out
git commit -m "test(attachments): e2e upload flow and R2 setup docs"
```
