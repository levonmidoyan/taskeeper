import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { comment } from '@/db';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { createComment, deleteComment, updateComment } from '@/server/comments/service';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const madeTask = await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });
  if (!madeTask.ok) throw new Error('setup failed');
  return { ctx, ws, projectId: created.data.id, taskId: madeTask.data.id };
}

/** A second member of the same workspace, with the given role. */
async function addMember(workspaceId: string, slug: string, email: string, role: 'admin' | 'member') {
  const user = await createUser(email, 'Grace');
  await joinWorkspace(user.id, workspaceId, role);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId, slug, role, timezone: 'Asia/Yerevan',
  };
  return ctx;
}

describe('createComment', () => {
  it('stores a comment authored by the caller', async () => {
    const { ctx, taskId } = await setup('c1@example.com', 'ws-c1');

    const result = await createComment(ctx, { taskId, body: '  Looks good  ' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(comment);
    expect(row.body).toBe('Looks good');
    expect(row.authorId).toBe(ctx.userId);
    expect(row.workspaceId).toBe(ctx.workspaceId);
    expect(row.editedAt).toBeNull();
  });

  // Review Focus 1.
  it('rejects a whitespace-only body', async () => {
    const { ctx, taskId } = await setup('c2@example.com', 'ws-c2');

    const result = await createComment(ctx, { taskId, body: '   \n  ' });

    expect(result).toEqual({ ok: false, error: 'Write something first.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  it('rejects a body over 10,000 characters', async () => {
    const { ctx, taskId } = await setup('c3@example.com', 'ws-c3');

    const result = await createComment(ctx, { taskId, body: 'x'.repeat(10_001) });

    expect(result).toEqual({ ok: false, error: 'That comment is too long.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  // Review Focus 2.
  it('refuses a task in another workspace', async () => {
    const a = await setup('c4a@example.com', 'ws-c4a');
    const b = await setup('c4b@example.com', 'ws-c4b');

    const result = await createComment(b.ctx, { taskId: a.taskId, body: 'Sneaky' });

    expect(result).toEqual({ ok: false, error: 'Task not found.' });
    expect(await db.select().from(comment)).toHaveLength(0);
  });
});

describe('updateComment', () => {
  it('lets the author edit and stamps edited_at', async () => {
    const { ctx, taskId } = await setup('c5@example.com', 'ws-c5');
    const created = await createComment(ctx, { taskId, body: 'Draft' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateComment(ctx, { commentId: created.data.id, body: 'Final' });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(comment).where(eq(comment.id, created.data.id));
    expect(row.body).toBe('Final');
    expect(row.editedAt).toBeInstanceOf(Date);
  });

  // Review Focus 3.
  it('refuses an edit by anyone but the author, admins included', async () => {
    const { ctx, ws, taskId } = await setup('c6@example.com', 'ws-c6');
    const created = await createComment(ctx, { taskId, body: 'Mine' });
    if (!created.ok) throw new Error('setup failed');
    const admin = await addMember(ws.id, 'ws-c6', 'c6-admin@example.com', 'admin');

    const result = await updateComment(admin, { commentId: created.data.id, body: 'Yours' });

    expect(result).toEqual({ ok: false, error: 'You can only edit your own comments.' });
    const [row] = await db.select().from(comment).where(eq(comment.id, created.data.id));
    expect(row.body).toBe('Mine');
  });
});

describe('deleteComment', () => {
  it('lets the author delete', async () => {
    const { ctx, taskId } = await setup('c7@example.com', 'ws-c7');
    const created = await createComment(ctx, { taskId, body: 'Oops' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteComment(ctx, { commentId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  it('lets an admin delete someone else\'s comment', async () => {
    const { ctx, ws, taskId } = await setup('c8@example.com', 'ws-c8');
    const member = await addMember(ws.id, 'ws-c8', 'c8-member@example.com', 'member');
    const created = await createComment(member, { taskId, body: 'Spam' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteComment(ctx, { commentId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(comment)).toHaveLength(0);
  });

  // Review Focus 3.
  it('refuses a plain member deleting someone else\'s comment', async () => {
    const { ctx, ws, taskId } = await setup('c9@example.com', 'ws-c9');
    const created = await createComment(ctx, { taskId, body: 'Mine' });
    if (!created.ok) throw new Error('setup failed');
    const other = await addMember(ws.id, 'ws-c9', 'c9-member@example.com', 'member');

    const result = await deleteComment(other, { commentId: created.data.id });

    expect(result).toEqual({ ok: false, error: 'You can only delete your own comments.' });
    expect(await db.select().from(comment)).toHaveLength(1);
  });

  // Review Focus 2.
  it('refuses a comment id from another workspace', async () => {
    const a = await setup('c10a@example.com', 'ws-c10a');
    const b = await setup('c10b@example.com', 'ws-c10b');
    const created = await createComment(a.ctx, { taskId: a.taskId, body: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    const result = await deleteComment(b.ctx, { commentId: created.data.id });

    expect(result).toEqual({ ok: false, error: 'Comment not found.' });
    expect(await db.select().from(comment)).toHaveLength(1);
  });
});
