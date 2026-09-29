import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
} from '@/server/tasks/service';
import { getTask, getTaskDetail, listMyOpenTasks, listProjectTasks, searchTasks } from '@/server/tasks/queries';
import { createLabel } from '@/server/labels/service';
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

  it('sets every field the create form offers in one call', async () => {
    const { ctx, projectId, statuses } = await setup('full@example.com', 'full');
    const label = await createLabel(ctx, { name: 'bug' });
    if (!label.ok) throw new Error('setup failed');

    const result = await createTask(ctx, {
      projectId,
      title: 'Full form',
      statusId: statuses[1].id,
      description: 'Some **details**',
      priority: 'high',
      assigneeId: ctx.userId,
      dueDate: '2026-10-01',
      labelIds: [label.data.id, label.data.id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = await getTaskDetail(ctx, result.data.id);
    expect(detail).toMatchObject({
      statusId: statuses[1].id,
      description: 'Some **details**',
      priority: 'high',
      assigneeId: ctx.userId,
      dueDate: '2026-10-01',
    });
    expect(detail!.labels.map((l) => l.id)).toEqual([label.data.id]);
  });

  it('sets completed_at when created straight into a done column', async () => {
    const { ctx, projectId, statuses } = await setup('done@example.com', 'done-ws');
    const done = statuses.find((s) => s.isDone)!;

    const result = await createTask(ctx, { projectId, title: 'Already done', statusId: done.id });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(task);
    expect(row.completedAt).not.toBeNull();
  });

  it('rejects an assignee outside the workspace', async () => {
    const a = await setup('as-a@example.com', 'as-a');
    const b = await setup('as-b@example.com', 'as-b');

    const result = await createTask(a.ctx, { projectId: a.projectId, title: 'X', assigneeId: b.ctx.userId });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(0);
  });

  it('rejects a label from another workspace', async () => {
    const a = await setup('lb-a@example.com', 'lb-a');
    const b = await setup('lb-b@example.com', 'lb-b');
    const foreign = await createLabel(b.ctx, { name: 'theirs' });
    if (!foreign.ok) throw new Error('setup failed');

    const result = await createTask(a.ctx, { projectId: a.projectId, title: 'X', labelIds: [foreign.data.id] });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(0);
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
    expect(detail!.projectId).toBe(projectId);
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

describe('searchTasks', () => {
  it('matches titles case-insensitively, open work first', async () => {
    const { ctx, projectId, statuses } = await setup('s1@example.com', 'search-a');
    const done = await createTask(ctx, { projectId, title: 'Fix login bug' });
    await createTask(ctx, { projectId, title: 'Write docs' });
    await createTask(ctx, { projectId, title: 'LOGIN page copy' });
    if (!done.ok) throw new Error('setup failed');
    const doneColumn = statuses.find((s) => s.isDone)!;
    await updateTask(ctx, { taskId: done.data.id, statusId: doneColumn.id });

    const hits = await searchTasks(ctx, 'login');

    expect(hits.map((h) => h.title)).toEqual(['LOGIN page copy', 'Fix login bug']);
    expect(hits[0]).toMatchObject({ projectId, projectName: 'Website', completed: false });
    expect(hits[1].completed).toBe(true);
  });

  it('treats LIKE wildcards literally', async () => {
    const { ctx, projectId } = await setup('s2@example.com', 'search-b');
    await createTask(ctx, { projectId, title: 'Grow 50% faster' });
    await createTask(ctx, { projectId, title: 'Grow 500 users' });

    expect((await searchTasks(ctx, '50%')).map((h) => h.title)).toEqual(['Grow 50% faster']);
  });

  it('never returns another workspace’s tasks', async () => {
    const a = await setup('s3@example.com', 'search-c');
    const b = await setup('s4@example.com', 'search-d');
    await createTask(b.ctx, { projectId: b.projectId, title: 'Secret roadmap' });

    expect(await searchTasks(a.ctx, 'roadmap')).toEqual([]);
  });
});

describe('bulkUpdateTasks', () => {
  it('applies one patch to every selected task', async () => {
    const { ctx, projectId, statuses } = await setup('bulk1@example.com', 'bulk1');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    if (!a.ok || !b.ok) throw new Error('setup failed');
    const done = statuses.find((s) => s.isDone)!;

    const result = await bulkUpdateTasks(ctx, {
      taskIds: [a.data.id, b.data.id],
      patch: { statusId: done.id, priority: 'high' },
    });

    expect(result).toEqual({ ok: true, data: { updated: 2 } });
    const tasks = await listProjectTasks(ctx, projectId);
    expect(tasks.every((t) => t.statusId === done.id && t.priority === 'high')).toBe(true);
    expect(tasks.every((t) => t.completedAt !== null)).toBe(true);
  });

  it('rejects an empty patch', async () => {
    const { ctx, projectId } = await setup('bulk2@example.com', 'bulk2');
    const a = await createTask(ctx, { projectId, title: 'A' });
    if (!a.ok) throw new Error('setup failed');

    expect((await bulkUpdateTasks(ctx, { taskIds: [a.data.id], patch: {} })).ok).toBe(false);
  });

  it('leaves another workspace’s tasks alone', async () => {
    const a = await setup('bulk3@example.com', 'bulk3');
    const b = await setup('bulk4@example.com', 'bulk4');
    const mine = await createTask(a.ctx, { projectId: a.projectId, title: 'Mine' });
    const theirs = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!mine.ok || !theirs.ok) throw new Error('setup failed');

    const result = await bulkUpdateTasks(a.ctx, {
      taskIds: [mine.data.id, theirs.data.id],
      patch: { priority: 'urgent' },
    });

    expect(result.ok).toBe(false);
    const [row] = await listProjectTasks(b.ctx, b.projectId);
    expect(row.priority).toBe('none');
  });
});

describe('bulkDeleteTasks', () => {
  it('deletes only this workspace’s tasks', async () => {
    const a = await setup('bulk5@example.com', 'bulk5');
    const b = await setup('bulk6@example.com', 'bulk6');
    const one = await createTask(a.ctx, { projectId: a.projectId, title: 'One' });
    const two = await createTask(a.ctx, { projectId: a.projectId, title: 'Two' });
    const keep = await createTask(a.ctx, { projectId: a.projectId, title: 'Keep' });
    const theirs = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!one.ok || !two.ok || !keep.ok || !theirs.ok) throw new Error('setup failed');

    const result = await bulkDeleteTasks(a.ctx, {
      taskIds: [one.data.id, two.data.id, theirs.data.id],
    });

    expect(result).toEqual({ ok: true, data: { deleted: 2 } });
    expect((await listProjectTasks(a.ctx, a.projectId)).map((t) => t.title)).toEqual(['Keep']);
    expect(await listProjectTasks(b.ctx, b.projectId)).toHaveLength(1);
  });
});
