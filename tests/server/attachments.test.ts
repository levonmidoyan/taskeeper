import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import { attachment, taskActivity } from '@/db';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { headObject } from '@/lib/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject, deleteProject } from '@/server/projects/service';
import { bulkDeleteTasks, createTask, deleteTask } from '@/server/tasks/service';
import { prepareAccountDeletion } from '@/server/account/deletion';
import { task } from '@/db';
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

  // A confirm whose response was lost is retried; the retry must see success,
  // not re-upload the file, and must not record the attachment again.
  it('answers a repeat confirm with the attachment and records it once', async () => {
    const { ctx, taskId } = await setup('b5@example.com', 'ws-b5');
    const view = await attach(ctx, taskId);

    const again = await confirmUpload(ctx, { attachmentId: view.id });

    expect(again).toMatchObject({ ok: true, data: { id: view.id } });
    expect(await db.select().from(taskActivity).where(eq(taskActivity.kind, 'attachment_added'))).toHaveLength(1);
  });

  it('refuses a repeat confirm from someone other than the uploader', async () => {
    const { ctx, ws, taskId } = await setup('b7@example.com', 'ws-b7');
    const other = await addMember(ws.id, 'ws-b7', 'b7o@example.com', 'admin');
    const view = await attach(ctx, taskId);

    expect(await confirmUpload(other, { attachmentId: view.id }))
      .toEqual({ ok: false, error: 'Upload did not finish.' });
  });
});

describe('confirmUpload concurrency', () => {
  it('answers both of two simultaneous confirms and records one activity', async () => {
    const { ctx, taskId } = await setup('b6@example.com', 'ws-b6');
    const req = await requestUpload(ctx, { taskId, fileName: 'x', contentType: 'text/plain', size: bytes.length });
    if (!req.ok) throw new Error();
    await uploadTo(req.data.url, bytes, 'text/plain');

    const results = await Promise.all([
      confirmUpload(ctx, { attachmentId: req.data.id }),
      confirmUpload(ctx, { attachmentId: req.data.id }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
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

describe('deleteAttachment concurrency', () => {
  it('lets one of two simultaneous deletes win and records one activity', async () => {
    const { ctx, taskId } = await setup('d5@example.com', 'ws-d5');
    const view = await attach(ctx, taskId);

    const results = await Promise.all([
      deleteAttachment(ctx, { attachmentId: view.id }),
      deleteAttachment(ctx, { attachmentId: view.id }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'Attachment not found.' }]);
    expect(await db.select().from(taskActivity).where(eq(taskActivity.kind, 'attachment_removed'))).toHaveLength(1);
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

describe('files of deleted work', () => {
  const keyOf = (ctx: WorkspaceContext, taskId: string, id: string) => `ws/${ctx.workspaceId}/tasks/${taskId}/${id}`;

  it('go with a deleted task, subtasks included', async () => {
    const { ctx, taskId } = await setup('purge-task@example.com', 'purge-task');
    const [parent] = await db.select().from(task).where(eq(task.id, taskId));
    const sub = await createTask(ctx, { projectId: parent.projectId, title: 'Sub', parentTaskId: taskId });
    if (!sub.ok) throw new Error('setup failed');
    const own = await attach(ctx, taskId);
    const child = await attach(ctx, sub.data.id);

    expect((await deleteTask(ctx, { taskId })).ok).toBe(true);
    expect(await headObject(keyOf(ctx, taskId, own.id))).toBeNull();
    expect(await headObject(keyOf(ctx, sub.data.id, child.id))).toBeNull();
  });

  it('go with a bulk delete', async () => {
    const { ctx, taskId } = await setup('purge-bulk@example.com', 'purge-bulk');
    const view = await attach(ctx, taskId);

    expect((await bulkDeleteTasks(ctx, { taskIds: [taskId] })).ok).toBe(true);
    expect(await headObject(keyOf(ctx, taskId, view.id))).toBeNull();
  });

  it('go with a deleted project', async () => {
    const { ctx, taskId } = await setup('purge-project@example.com', 'purge-project');
    const [row] = await db.select().from(task).where(eq(task.id, taskId));
    const view = await attach(ctx, taskId);

    expect((await deleteProject(ctx, { projectId: row.projectId })).ok).toBe(true);
    expect(await headObject(keyOf(ctx, taskId, view.id))).toBeNull();
  });

  it('go with a solo workspace when its owner deletes their account', async () => {
    const { ctx, taskId } = await setup('purge-account@example.com', 'purge-account');
    const view = await attach(ctx, taskId);

    await prepareAccountDeletion(ctx.userId);
    expect(await headObject(keyOf(ctx, taskId, view.id))).toBeNull();
  });

  it('stay when another workspace deletes its task', async () => {
    const a = await setup('purge-a@example.com', 'purge-a');
    const b = await setup('purge-b@example.com', 'purge-b');
    const view = await attach(b.ctx, b.taskId);

    expect((await deleteTask(a.ctx, { taskId: b.taskId })).ok).toBe(false);
    expect(await headObject(keyOf(b.ctx, b.taskId, view.id))).not.toBeNull();
  });
});
