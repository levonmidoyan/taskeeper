import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { apiFixture, call } from '../setup/api';
import { createUser, joinWorkspace } from '../setup/factories';
import { comment, user, workspaceChange } from '@/db';
import { resolveWorkspace } from '@/lib/session';
import { createComment } from '@/server/comments/service';
import { archiveProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import * as comments from '@/app/api/v1/workspaces/[slug]/tasks/[taskId]/comments/route';

beforeEach(resetDb);
afterAll(closeDb);

async function withTask(tag: string) {
  const f = await apiFixture(tag);
  const made = await createTask(f.ctx, { projectId: f.project.id, title: 'T' });
  if (!made.ok) throw new Error(made.error);
  return { ...f, taskId: made.data.id };
}

type F = Awaited<ReturnType<typeof withTask>>;

const post = (f: F, body: unknown, taskId = f.taskId) =>
  call(comments.POST, { method: 'POST', path: `/workspaces/${f.ws.slug}/tasks/${taskId}/comments`, token: f.ada.token, params: { slug: f.ws.slug, taskId }, body });
const get = (f: F, taskId = f.taskId) =>
  call(comments.GET, { path: `/workspaces/${f.ws.slug}/tasks/${taskId}/comments`, token: f.ada.token, params: { slug: f.ws.slug, taskId } });

describe('POST comments', () => {
  it('comments as the token owner and bumps the change stamp', async () => {
    const f = await withTask('m1');

    const res = await post(f, { body: '  Looks good  ' });

    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: expect.any(String), author: { id: f.ada.id, name: 'Ada' }, body: 'Looks good',
      createdAt: expect.stringMatching(/Z$/), editedAt: null,
    });
    const [row] = await db.select().from(comment);
    expect(row.authorId).toBe(f.ada.id);
    const [stamp] = await db.select().from(workspaceChange).where(eq(workspaceChange.workspaceId, f.ws.id));
    expect(stamp.version).toBeGreaterThan(0);
  });

  it('400s an empty body', async () => {
    const f = await withTask('m2');
    const res = await post(f, { body: '   ' });
    expect(res.status).toBe(400);
    expect(res.json.error.issues).toEqual([{ path: 'body.body', message: 'Write something first.' }]);
  });
});

describe('GET comments', () => {
  it('lists comments oldest first, and only comments', async () => {
    const f = await withTask('m3');
    await post(f, { body: 'First' });
    await post(f, { body: 'Second' });

    const res = await get(f);

    expect(res.json.data.map((c: { body: string }) => c.body)).toEqual(['First', 'Second']);
  });

  it('shows a deleted author as null', async () => {
    const f = await withTask('m4');
    const bob = await createUser('m4b@example.com', 'Bob');
    await joinWorkspace(bob.id, f.ws.id, 'member');
    const bobCtx = (await resolveWorkspace(bob.id, f.ws.slug))!;
    await createComment(bobCtx, { taskId: f.taskId, body: 'Bye' });
    await db.delete(user).where(eq(user.id, bob.id));

    const res = await get(f);

    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([expect.objectContaining({ body: 'Bye', author: null })]);
  });

  it('404s a task in an archived project or another workspace, for both methods', async () => {
    const f = await withTask('m5');
    const g = await withTask('m5b');
    expect((await get(f, g.taskId)).status).toBe(404);
    expect((await post(f, { body: 'x' }, g.taskId)).status).toBe(404);

    await archiveProject(f.ctx, { projectId: f.project.id });
    expect((await get(f)).status).toBe(404);
    expect((await post(f, { body: 'x' })).status).toBe(404);
  });
});
