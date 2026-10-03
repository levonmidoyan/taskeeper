import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { archiveProject, createProject } from '@/server/projects/service';
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
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan',
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

  it('gives concurrent creates in one column distinct positions', async () => {
    const { ctx, projectId } = await setup('ada-race@example.com', 'acme-race');

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createTask(ctx, { projectId, title: `T${i}` })),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    const positions = (await listProjectTasks(ctx, projectId)).map((t) => t.position);
    expect(new Set(positions).size).toBe(8);
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

  it('rejects a parent task from another workspace', async () => {
    const a = await setup('pt-a@example.com', 'pt-a');
    const b = await setup('pt-b@example.com', 'pt-b');
    const foreign = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    if (!foreign.ok) throw new Error('setup failed');

    const result = await createTask(a.ctx, {
      projectId: a.projectId, title: 'Child', parentTaskId: foreign.data.id,
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(1);
  });

  it('rejects a parent task from another project', async () => {
    const { ctx, projectId } = await setup('pt-p@example.com', 'pt-p');
    const other = await createProject(ctx, { name: 'Other' });
    if (!other.ok) throw new Error('setup failed');
    const parent = await createTask(ctx, { projectId: other.data.id, title: 'Elsewhere' });
    if (!parent.ok) throw new Error('setup failed');

    const result = await createTask(ctx, { projectId, title: 'Child', parentTaskId: parent.data.id });

    expect(result.ok).toBe(false);
    expect(await db.select().from(task)).toHaveLength(1);
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

  it('rejects an assignee outside the workspace', async () => {
    const a = await setup('ua-a@example.com', 'ua-a');
    const b = await setup('ua-b@example.com', 'ua-b');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Mine' });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(a.ctx, { taskId: created.data.id, assigneeId: b.ctx.userId });

    expect(result.ok).toBe(false);
    expect((await getTask(a.ctx, created.data.id))!.assigneeId).toBeNull();
  });

  it('still allows clearing the assignee', async () => {
    const { ctx, projectId } = await setup('ua-c@example.com', 'ua-c');
    const created = await createTask(ctx, { projectId, title: 'Mine', assigneeId: ctx.userId });
    if (!created.ok) throw new Error('setup failed');

    const result = await updateTask(ctx, { taskId: created.data.id, assigneeId: null });

    expect(result.ok).toBe(true);
    expect((await getTask(ctx, created.data.id))!.assigneeId).toBeNull();
  });

  it('appends a task to the end of the column it moves to', async () => {
    const { ctx, projectId, statuses } = await setup('ada-col@example.com', 'acme-col');
    const a = await createTask(ctx, { projectId, title: 'A', statusId: statuses[1].id });
    // Created first in its own column, so it holds the same key as A.
    const b = await createTask(ctx, { projectId, title: 'B' });
    if (!a.ok || !b.ok) throw new Error('setup failed');

    expect((await updateTask(ctx, { taskId: b.data.id, statusId: statuses[1].id })).ok).toBe(true);

    const column = (await listProjectTasks(ctx, projectId)).filter((t) => t.statusId === statuses[1].id);
    expect(column.map((t) => t.title)).toEqual(['A', 'B']);
    expect(column[0].position < column[1].position).toBe(true);
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

  it('gives concurrent drops into the same gap distinct positions', async () => {
    const { ctx, projectId, statuses } = await setup('ada-gap@example.com', 'acme-gap');
    // One at a time, so A sorts before B.
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C', 'D']) {
      const made = await createTask(ctx, { projectId, title });
      if (!made.ok) throw new Error('setup failed');
      ids.push(made.data.id);
    }
    const [a, b, c, d] = ids;

    const results = await Promise.all([c, d].map((taskId) =>
      moveTask(ctx, { taskId, statusId: statuses[0].id, beforeId: a, afterId: b })));

    expect(results.every((r) => r.ok)).toBe(true);
    const positions = (await listProjectTasks(ctx, projectId)).map((t) => t.position);
    expect(new Set(positions).size).toBe(4);
  });

  it('drops between two tasks that share a position', async () => {
    const { ctx, projectId, statuses } = await setup('tie@example.com', 'tie');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');
    // What two concurrent creates in one column leave behind.
    const [bRow] = await db.select().from(task).where(eq(task.id, b.data.id));
    await db.update(task).set({ position: bRow.position }).where(eq(task.id, c.data.id));
    const [first, second] = [b.data, c.data].sort((x, y) => (x.id < y.id ? -1 : 1));

    const result = await moveTask(ctx, {
      taskId: a.data.id, statusId: statuses[0].id, beforeId: first.id, afterId: second.id,
    });

    expect(result.ok).toBe(true);
    const ordered = await listProjectTasks(ctx, projectId);
    expect(ordered.map((t) => t.id)).toEqual([first.id, a.data.id, second.id]);
  });

  it('refuses neighbours that are out of order with a clear message', async () => {
    const { ctx, projectId, statuses } = await setup('stale@example.com', 'stale');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const b = await createTask(ctx, { projectId, title: 'B' });
    const c = await createTask(ctx, { projectId, title: 'C' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    const result = await moveTask(ctx, {
      taskId: b.data.id, statusId: statuses[0].id, beforeId: c.data.id, afterId: a.data.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toMatch(/Something went wrong/);
    expect((await listProjectTasks(ctx, projectId)).map((t) => t.title)).toEqual(['A', 'B', 'C']);
  });

  it('refuses a neighbour from a different column', async () => {
    const { ctx, projectId, statuses } = await setup('col@example.com', 'col');
    const a = await createTask(ctx, { projectId, title: 'A' });
    const x = await createTask(ctx, { projectId, title: 'X', statusId: statuses[1].id });
    if (!a.ok || !x.ok) throw new Error('setup failed');

    const result = await moveTask(ctx, {
      taskId: a.data.id, statusId: statuses[0].id, beforeId: x.data.id, afterId: null,
    });

    expect(result.ok).toBe(false);
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

    // "50" is also a word prefix of "500", so both match; the literal hit leads.
    expect((await searchTasks(ctx, '50%')).map((h) => h.title)).toEqual(['Grow 50% faster', 'Grow 500 users']);
  });

  it('never returns another workspace’s tasks', async () => {
    const a = await setup('s3@example.com', 'search-c');
    const b = await setup('s4@example.com', 'search-d');
    await createTask(b.ctx, { projectId: b.projectId, title: 'Secret roadmap' });

    expect(await searchTasks(a.ctx, 'roadmap')).toEqual([]);
  });

  it('finds a word that only appears in the description, with a snippet', async () => {
    const { ctx, projectId } = await setup('s5@example.com', 'search-e');
    await createTask(ctx, {
      projectId,
      title: 'Release checklist',
      description: 'Before shipping, run the staging migration and smoke tests.',
    });

    const [hit] = await searchTasks(ctx, 'migration');

    expect(hit.title).toBe('Release checklist');
    expect(hit.snippet).toContain('«migration»');
  });

  it('returns snippets as plain text, not Markdown', async () => {
    const { ctx, projectId } = await setup('s13@example.com', 'search-m');
    await createTask(ctx, { projectId, title: 'Ops', description: '**Rotate** the [gateway](https://x.dev) keys' });

    const [hit] = await searchTasks(ctx, 'gateway');

    expect(hit.snippet).toBe('Rotate the «gateway» keys');
  });

  it('matches word prefixes while typing', async () => {
    const { ctx, projectId } = await setup('s6@example.com', 'search-f');
    // In the description, so the title substring match cannot be what finds it.
    await createTask(ctx, { projectId, title: 'Ops notes', description: 'Deployment steps' });

    expect((await searchTasks(ctx, 'deplo')).map((h) => h.title)).toEqual(['Ops notes']);
  });

  it('has no snippet when the title matched', async () => {
    const { ctx, projectId } = await setup('s7@example.com', 'search-g');
    await createTask(ctx, { projectId, title: 'Billing page', description: 'Billing copy update' });

    const [hit] = await searchTasks(ctx, 'billing');

    expect(hit.snippet).toBeNull();
  });

  it('ranks a title match above a description-only match', async () => {
    const { ctx, projectId } = await setup('s8@example.com', 'search-h');
    await createTask(ctx, { projectId, title: 'Misc', description: 'Mentions invoice once' });
    await createTask(ctx, { projectId, title: 'Invoice export' });

    expect((await searchTasks(ctx, 'invoice')).map((h) => h.title)).toEqual(['Invoice export', 'Misc']);
  });

  it('skips archived tasks and tasks in archived projects', async () => {
    const { ctx, projectId } = await setup('s9@example.com', 'search-i');
    const gone = await createTask(ctx, { projectId, title: 'Shelved widget' });
    const other = await createProject(ctx, { name: 'Old' });
    if (!gone.ok || !other.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId: other.data.id, title: 'Old widget' });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, gone.data.id));
    await archiveProject(ctx, { projectId: other.data.id });

    expect(await searchTasks(ctx, 'widget')).toEqual([]);
  });

  it('never returns another workspace’s description match', async () => {
    const a = await setup('s10@example.com', 'search-j');
    const b = await setup('s11@example.com', 'search-k');
    await createTask(b.ctx, { projectId: b.projectId, title: 'Plan', description: 'confidential acquisition' });
    await createTask(a.ctx, { projectId: a.projectId, title: 'Plan', description: 'public notes' });

    expect(await searchTasks(a.ctx, 'acquisition')).toEqual([]);
  });

  it('survives operator-only and stop-word-only input', async () => {
    const { ctx, projectId } = await setup('s12@example.com', 'search-l');
    await createTask(ctx, { projectId, title: 'The plan' });

    expect(await searchTasks(ctx, '&|!:*()')).toEqual([]);
    // "the" is an English stop word, so FTS ignores it; the title ILIKE still finds it.
    expect((await searchTasks(ctx, 'the')).map((h) => h.title)).toEqual(['The plan']);
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

  it('changes nothing when one task in the set cannot be updated', async () => {
    const { ctx, projectId } = await setup('bulk-atomic@example.com', 'bulk-atomic');
    const live = await createTask(ctx, { projectId, title: 'Live' });
    const other = await createProject(ctx, { name: 'Shelved' });
    if (!live.ok || !other.ok) throw new Error('setup failed');
    const shelved = await createTask(ctx, { projectId: other.data.id, title: 'Shelved' });
    if (!shelved.ok) throw new Error('setup failed');
    await archiveProject(ctx, { projectId: other.data.id });

    const result = await bulkUpdateTasks(ctx, {
      taskIds: [live.data.id, shelved.data.id],
      patch: { priority: 'urgent' },
    });

    expect(result.ok).toBe(false);
    const [row] = await db.select().from(task).where(eq(task.id, live.data.id));
    expect(row.priority).toBe('none');
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

describe('position order under a locale collation', () => {
  // Alpine's Postgres sorts en_US like "C", so this borrows an ICU collation to
  // stand in for a glibc host, where 'aB' sorts after 'ab'.
  async function withLocaleCollation(run: () => Promise<void>) {
    await db.execute(sql`alter table task alter column position type text collate "en-US-x-icu"`);
    try {
      await run();
    } finally {
      await db.execute(sql`alter table task alter column position type text collate "default"`);
    }
  }

  it('lists a column and appends to it in key order', async () => {
    await withLocaleCollation(async () => {
      const { ctx, projectId } = await setup('ada-icu@example.com', 'acme-icu');
      const a = await createTask(ctx, { projectId, title: 'A' });
      const b = await createTask(ctx, { projectId, title: 'B' });
      if (!a.ok || !b.ok) throw new Error('setup failed');
      await db.update(task).set({ position: 'aB' }).where(eq(task.id, a.data.id));
      await db.update(task).set({ position: 'ab' }).where(eq(task.id, b.data.id));

      expect((await createTask(ctx, { projectId, title: 'C' })).ok).toBe(true);

      const tasks = await listProjectTasks(ctx, projectId);
      expect(tasks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
      expect(tasks[1].position < tasks[2].position).toBe(true);
    });
  });
});

describe('archived projects', () => {
  it('404s the board, hides its tasks from My tasks, and refuses writes', async () => {
    const { ctx, projectId } = await setup('arch@example.com', 'arch');
    const created = await createTask(ctx, { projectId, title: 'Left behind' });
    if (!created.ok) throw new Error('setup failed');
    await updateTask(ctx, { taskId: created.data.id, assigneeId: ctx.userId });
    await archiveProject(ctx, { projectId });

    expect(await getProject(ctx, projectId)).toBeNull();
    expect(await listMyOpenTasks(ctx)).toEqual([]);
    expect((await createTask(ctx, { projectId, title: 'New' })).ok).toBe(false);
    expect((await updateTask(ctx, { taskId: created.data.id, title: 'Edited' })).ok).toBe(false);
  });
});

describe('due dates', () => {
  it('rejects a well-formed string that is not a calendar day', async () => {
    const { ctx, projectId } = await setup('due@example.com', 'due');
    const result = await createTask(ctx, { projectId, title: 'Leap', dueDate: '2026-02-30' });
    expect(result.ok).toBe(false);
  });
});
