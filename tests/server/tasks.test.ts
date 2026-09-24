import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { createTask, deleteTask, moveTask, updateTask } from '@/server/tasks/service';
import { getTask, getTaskDetail, listMyOpenTasks, listProjectTasks } from '@/server/tasks/queries';
import { task } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, created.data.id);
  return { ctx, projectId: created.data.id, statuses: detail!.statuses };
}

describe('createTask', () => {
  it('creates a task in the first status by default', async () => {
    const { ctx, projectId, statuses } = await setup('ada@example.com', 'acme');

    const result = await createTask(ctx, { projectId, title: 'Ship v1' });

    expect(result.ok).toBe(true);
    const tasks = await listProjectTasks(ctx, projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ship v1');
    expect(tasks[0].statusId).toBe(statuses[0].id);
    expect(tasks[0].priority).toBe('none');
  });

  it('stamps workspace_id from the context, never from the caller', async () => {
    const { ctx, projectId } = await setup('ada2@example.com', 'acme2');
    const other = await setup('bob@example.com', 'bob-ws');

    // A caller trying to smuggle in another workspace's id must be ignored.
    await createTask(ctx, { projectId, title: 'Smuggled', workspaceId: other.ctx.workspaceId } as never);

    const [row] = await db.select().from(task);
    expect(row.workspaceId).toBe(ctx.workspaceId);
  });

  it('rejects an empty title', async () => {
    const { ctx, projectId } = await setup('ada3@example.com', 'acme3');
    expect((await createTask(ctx, { projectId, title: '  ' })).ok).toBe(false);
  });

  it('refuses to create in another workspace’s project', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    const result = await createTask(a.ctx, { projectId: b.projectId, title: 'Trespass' });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(0);
  });

  it('appends each new task after the previous one', async () => {
    const { ctx, projectId } = await setup('ada4@example.com', 'acme4');
    await createTask(ctx, { projectId, title: 'First' });
    await createTask(ctx, { projectId, title: 'Second' });

    const tasks = await listProjectTasks(ctx, projectId);
    expect(tasks.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(tasks[0].position < tasks[1].position).toBe(true);
  });
});

describe('updateTask', () => {
  it('sets completed_at when moved to a done status', async () => {
    const { ctx, projectId, statuses } = await setup('ada5@example.com', 'acme5');
    const created = await createTask(ctx, { projectId, title: 'Finish me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: created.data.id, statusId: done.id });

    const after = await getTask(ctx, created.data.id);
    expect(after!.completedAt).not.toBeNull();
  });

  it('clears completed_at when moved back out of a done status', async () => {
    const { ctx, projectId, statuses } = await setup('ada6@example.com', 'acme6');
    const created = await createTask(ctx, { projectId, title: 'Reopen me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: created.data.id, statusId: done.id });
    await updateTask(ctx, { taskId: created.data.id, statusId: statuses[0].id });

    const after = await getTask(ctx, created.data.id);
    expect(after!.completedAt).toBeNull();
  });

  it('stores a due date as the exact calendar string given', async () => {
    const { ctx, projectId } = await setup('ada7@example.com', 'acme7');
    const created = await createTask(ctx, { projectId, title: 'Due' });
    if (!created.ok) throw new Error('setup failed');

    await updateTask(ctx, { taskId: created.data.id, dueDate: '2026-09-21' });

    expect((await getTask(ctx, created.data.id))!.dueDate).toBe('2026-09-21');
  });

  it('refuses to update a task in another workspace', async () => {
    const a = await setup('a2@example.com', 'ws-a2');
    const b = await setup('b2@example.com', 'ws-b2');
    const created = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(a.ctx, { taskId: created.data.id, title: 'Hijacked' });

    expect(result.ok).toBe(false);
    expect((await getTask(b.ctx, created.data.id))!.title).toBe('Theirs');
  });

  it('refuses a status that belongs to a different project', async () => {
    const { ctx, projectId } = await setup('ada8@example.com', 'acme8');
    const otherProject = await createProject(ctx, { name: 'Other' });
    if (!otherProject.ok) throw new Error('setup failed');
    const otherDetail = await getProject(ctx, otherProject.data.id);

    const created = await createTask(ctx, { projectId, title: 'Task' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(ctx, {
      taskId: created.data.id, statusId: otherDetail!.statuses[0].id,
    });
    expect(result.ok).toBe(false);
  });
});

describe('moveTask', () => {
  it('places a task between two neighbours in the target column', async () => {
    const { ctx, projectId, statuses } = await setup('ada9@example.com', 'acme9');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    // Move C between A and B.
    const result = await moveTask(ctx, {
      taskId: c.data.id, statusId: statuses[0].id,
      beforeId: a.data.id, afterId: b.data.id,
    });

    expect(result.ok).toBe(true);
    const ordered = await listProjectTasks(ctx, projectId);
    expect(ordered.map((t) => t.title)).toEqual(['A', 'C', 'B']);
  });

  it('moves a task to another column and marks it complete when that column is done', async () => {
    const { ctx, projectId, statuses } = await setup('ada10@example.com', 'acme10');
    const created = await createTask(ctx, { projectId, title: 'Move me' });
    if (!created.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await moveTask(ctx, {
      taskId: created.data.id, statusId: done.id, beforeId: null, afterId: null,
    });

    const after = await getTask(ctx, created.data.id);
    expect(after!.statusId).toBe(done.id);
    expect(after!.completedAt).not.toBeNull();
  });

  it('survives repeated drops into the same gap', async () => {
    const { ctx, projectId, statuses } = await setup('ada11@example.com', 'acme11');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    for (let i = 0; i < 20; i++) {
      const result = await moveTask(ctx, {
        taskId: c.data.id, statusId: statuses[0].id,
        beforeId: a.data.id, afterId: b.data.id,
      });
      expect(result.ok).toBe(true);
    }

    const ordered = await listProjectTasks(ctx, projectId);
    expect(ordered.map((t) => t.title)).toEqual(['A', 'C', 'B']);
  });

  it('refuses to move a task into another workspace’s column', async () => {
    const a = await setup('a3@example.com', 'ws-a3');
    const b = await setup('b3@example.com', 'ws-b3');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Mine' });
    if (!created.ok) throw new Error('setup failed');

    const result = await moveTask(a.ctx, {
      taskId: created.data.id, statusId: b.statuses[0].id, beforeId: null, afterId: null,
    });
    expect(result.ok).toBe(false);
  });
});

describe('listMyOpenTasks', () => {
  it('returns only tasks assigned to the caller, flagging overdue by workspace zone', async () => {
    const { ctx, projectId } = await setup('ada12@example.com', 'acme12');
    const mine = await createTask(ctx, { projectId, title: 'Mine' });
    const theirs = await createTask(ctx, { projectId, title: 'Unassigned' });
    if (!mine.ok || !theirs.ok) throw new Error('setup failed');

    await updateTask(ctx, {
      taskId: mine.data.id, assigneeId: ctx.userId, dueDate: '2020-01-01',
    });

    const rows = await listMyOpenTasks(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Mine');
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].projectName).toBe('Website');
  });
});

describe('deleteTask', () => {
  it('deletes a task and its subtasks', async () => {
    const { ctx, projectId } = await setup('ada13@example.com', 'acme13');
    const parent = await createTask(ctx, { projectId, title: 'Parent' });
    if (!parent.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId, title: 'Child', parentTaskId: parent.data.id });

    await deleteTask(ctx, { taskId: parent.data.id });

    expect(await db.select().from(task)).toHaveLength(0);
  });

  it('refuses to delete a task in another workspace', async () => {
    const a = await setup('a4@example.com', 'ws-a4');
    const b = await setup('b4@example.com', 'ws-b4');
    const created = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!created.ok) throw new Error('setup failed');

    expect((await deleteTask(a.ctx, { taskId: created.data.id })).ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(1);
  });
});

describe('getTaskDetail', () => {
  it('returns a task with its subtasks and parent breadcrumb', async () => {
    const { ctx, projectId, statuses } = await setup('ada14@example.com', 'acme14');
    const parent = await createTask(ctx, { projectId, title: 'Parent' });
    if (!parent.ok) throw new Error('setup failed');
    const child = await createTask(ctx, {
      projectId, title: 'Child', parentTaskId: parent.data.id,
    });
    const other = await createTask(ctx, { projectId, title: 'Unrelated' });
    if (!child.ok || !other.ok) throw new Error('setup failed');

    const done = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: child.data.id, statusId: done.id });

    const detail = await getTaskDetail(ctx, parent.data.id);
    expect(detail).not.toBeNull();
    expect(detail!.parentId).toBeNull();
    expect(detail!.parentTitle).toBeNull();
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['Child']);
    expect(detail!.subtaskCount).toBe(1);
    expect(detail!.subtaskDoneCount).toBe(1);

    const childDetail = await getTaskDetail(ctx, child.data.id);
    expect(childDetail!.parentId).toBe(parent.data.id);
    expect(childDetail!.parentTitle).toBe('Parent');
    expect(childDetail!.subtasks).toEqual([]);
  });

  it('returns null for a task in another workspace', async () => {
    const a = await setup('a5@example.com', 'ws-a5');
    const b = await setup('b5@example.com', 'ws-b5');
    const created = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!created.ok) throw new Error('setup failed');

    expect(await getTaskDetail(a.ctx, created.data.id)).toBeNull();
  });
});
