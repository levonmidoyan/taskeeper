import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { taskActivity } from '@/db';
import { getProject } from '@/server/projects/queries';
import { createProject } from '@/server/projects/service';
import { deleteStatus, updateStatus } from '@/server/statuses/service';
import { createTask, moveTask, updateTask } from '@/server/tasks/service';
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
  const detail = await getProject(ctx, created.data.id);
  return { ctx, user, projectId: created.data.id, statuses: detail!.statuses };
}

const rows = (taskId: string) =>
  db.select().from(taskActivity).where(eq(taskActivity.taskId, taskId)).orderBy(asc(taskActivity.createdAt));

describe('activity recording', () => {
  it('records creation with the title', async () => {
    const { ctx, projectId } = await setup('a1@example.com', 'ws-a1');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    const entries = await rows(created.data.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('created');
    expect(entries[0].toValue).toBe('Ship v1');
    expect(entries[0].actorId).toBe(ctx.userId);
  });

  it('records a rename with both the old and the new title', async () => {
    const { ctx, projectId } = await setup('a2@example.com', 'ws-a2');
    const created = await createTask(ctx, { projectId, title: 'Old' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, title: 'New' });

    const entries = await rows(created.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created', 'title']);
    expect(entries[1].fromValue).toBe('Old');
    expect(entries[1].toValue).toBe('New');
  });

  it('records a status change by column name, not id', async () => {
    const { ctx, projectId, statuses } = await setup('a3@example.com', 'ws-a3');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[1].id });

    const entries = await rows(created.data.id);
    expect(entries[1].kind).toBe('status');
    expect(entries[1].fromValue).toBe('Todo');
    expect(entries[1].toValue).toBe('In Progress');
  });

  // Review Focus 5.
  it('keeps the column name after the column is renamed and deleted', async () => {
    const { ctx, projectId, statuses } = await setup('a4@example.com', 'ws-a4');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[1].id });

    await updateStatus(ctx, { statusId: statuses[1].id, name: 'Doing' });
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[0].id });
    const removed = await deleteStatus(ctx, { statusId: statuses[1].id });
    expect(removed.ok).toBe(true);

    const entries = await rows(created.data.id);
    expect(entries[1].toValue).toBe('In Progress');
  });

  it('records assignment and unassignment by member name', async () => {
    const { ctx, projectId } = await setup('a5@example.com', 'ws-a5');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    await updateTask(ctx, { taskId: created.data.id, assigneeId: ctx.userId });
    await updateTask(ctx, { taskId: created.data.id, assigneeId: null });

    const entries = await rows(created.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created', 'assignee', 'assignee']);
    expect(entries[1].toValue).toBe('Ada');
    expect(entries[2].fromValue).toBe('Ada');
    expect(entries[2].toValue).toBeNull();
  });

  it('does not record anything for a reorder inside the same column', async () => {
    const { ctx, projectId, statuses } = await setup('a6@example.com', 'ws-a6');
    const first = await createTask(ctx, { projectId, title: 'First' });
    const second = await createTask(ctx, { projectId, title: 'Second' });
    if (!first.ok || !second.ok) throw new Error('create failed');

    await moveTask(ctx, {
      taskId: second.data.id, statusId: statuses[0].id, beforeId: null, afterId: first.data.id,
    });

    const entries = await rows(second.data.id);
    expect(entries.map((e) => e.kind)).toEqual(['created']);
  });

  // Review Focus 4.
  it('writes no activity when the update is rejected', async () => {
    const a = await setup('a7@example.com', 'ws-a7');
    const b = await setup('b7@example.com', 'ws-b7');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('create failed');

    const result = await updateTask(a.ctx, {
      taskId: created.data.id, statusId: b.statuses[0].id,
    });

    expect(result.ok).toBe(false);
    expect((await rows(created.data.id)).map((e) => e.kind)).toEqual(['created']);
  });
});
