import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { apiFixture, apiUser, call } from '../setup/api';
import { joinWorkspace } from '../setup/factories';
import { task, taskActivity, workspaceChange } from '@/db';
import { appUrl } from '@/lib/url';
import { createLabel } from '@/server/labels/service';
import { getProject } from '@/server/projects/queries';
import { archiveProject, createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import * as tasks from '@/app/api/v1/workspaces/[slug]/tasks/route';
import * as oneTask from '@/app/api/v1/workspaces/[slug]/tasks/[taskId]/route';

beforeEach(resetDb);
afterAll(closeDb);

async function version(workspaceId: string) {
  const [row] = await db.select().from(workspaceChange).where(eq(workspaceChange.workspaceId, workspaceId));
  return row?.version ?? 0;
}

async function add(ctx: Parameters<typeof createTask>[0], input: Parameters<typeof createTask>[1]) {
  const made = await createTask(ctx, input);
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

function list(f: Awaited<ReturnType<typeof apiFixture>>, qs = '') {
  return call(tasks.GET, { path: `/workspaces/${f.ws.slug}/tasks${qs}`, token: f.ada.token, params: { slug: f.ws.slug } });
}

function one(f: Awaited<ReturnType<typeof apiFixture>>, taskId: string, init: { method?: string; body?: unknown } = {}) {
  return call(oneTask[(init.method ?? 'GET') as 'GET' | 'PATCH' | 'DELETE'], {
    path: `/workspaces/${f.ws.slug}/tasks/${taskId}`, token: f.ada.token, params: { slug: f.ws.slug, taskId }, ...init,
  });
}

describe('POST /tasks', () => {
  it('creates a task as the token owner, records activity and bumps the change stamp', async () => {
    const f = await apiFixture('k1');
    const before = await version(f.ws.id);

    const res = await call(tasks.POST, {
      method: 'POST', path: `/workspaces/${f.ws.slug}/tasks`, token: f.ada.token, params: { slug: f.ws.slug },
      body: { projectId: f.project.id, title: 'Ship it', priority: 'high', dueDate: '2026-11-01' },
    });

    expect(res.status).toBe(201);
    expect(res.json).toEqual({
      id: expect.any(String), projectId: f.project.id, parentTaskId: null, title: 'Ship it',
      status: { id: f.statuses[0].id, name: 'Todo', isDone: false }, priority: 'high', assignee: null,
      dueDate: '2026-11-01', labels: [], description: '',
      createdAt: expect.stringMatching(/Z$/), updatedAt: expect.stringMatching(/Z$/),
      url: `${appUrl()}/${f.ws.slug}/tasks/${res.json.id}`,
    });
    const [activity] = await db.select().from(taskActivity).where(eq(taskActivity.taskId, res.json.id));
    expect(activity).toMatchObject({ kind: 'created', actorId: f.ada.id });
    expect(await version(f.ws.id)).toBeGreaterThan(before);
  });

  it('400s a missing title with its path', async () => {
    const f = await apiFixture('k2');
    const res = await call(tasks.POST, {
      method: 'POST', path: `/workspaces/${f.ws.slug}/tasks`, token: f.ada.token, params: { slug: f.ws.slug },
      body: { projectId: f.project.id },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.issues[0].path).toBe('body.title');
  });

  it('422s a project that is archived', async () => {
    const f = await apiFixture('k3');
    await archiveProject(f.ctx, { projectId: f.project.id });
    const res = await call(tasks.POST, {
      method: 'POST', path: `/workspaces/${f.ws.slug}/tasks`, token: f.ada.token, params: { slug: f.ws.slug },
      body: { projectId: f.project.id, title: 'Nope' },
    });
    expect(res.status).toBe(422);
    expect(res.json.error).toEqual({ code: 'unprocessable', message: 'Project not found.' });
  });

  it('works for a plain member, as in the UI', async () => {
    const f = await apiFixture('k4');
    const bob = await apiUser('k4b@example.com', 'Bob');
    await joinWorkspace(bob.id, f.ws.id, 'member');
    const res = await call(tasks.POST, {
      method: 'POST', path: `/workspaces/${f.ws.slug}/tasks`, token: bob.token, params: { slug: f.ws.slug },
      body: { projectId: f.project.id, title: 'Mine' },
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /tasks', () => {
  it('defaults to open tasks; state=all adds done ones; subtasks are included', async () => {
    const f = await apiFixture('k5');
    const open = await add(f.ctx, { projectId: f.project.id, title: 'Open' });
    await add(f.ctx, { projectId: f.project.id, title: 'Done', statusId: f.statuses[2].id });
    await add(f.ctx, { projectId: f.project.id, title: 'Child', parentTaskId: open });

    const def = await list(f);
    expect(def.json.data.map((t: { title: string }) => t.title).sort()).toEqual(['Child', 'Open']);
    expect(def.json.data.find((t: { title: string }) => t.title === 'Child').parentTaskId).toBe(open);
    expect(def.json.nextCursor).toBeNull();

    const all = await list(f, '?state=all');
    expect(all.json.data).toHaveLength(3);
  });

  it('filters by project and status, assignee me, and sorts', async () => {
    const f = await apiFixture('k6');
    const other = await createProject(f.ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    await add(f.ctx, { projectId: f.project.id, title: 'B doing', statusId: f.statuses[1].id, assigneeId: f.ada.id });
    await add(f.ctx, { projectId: f.project.id, title: 'A todo' });
    await add(f.ctx, { projectId: other.data.id, title: 'C elsewhere', assigneeId: f.ada.id });

    const byStatus = await list(f, `?projectId=${f.project.id}&status=${f.statuses[1].id}`);
    expect(byStatus.json.data.map((t: { title: string }) => t.title)).toEqual(['B doing']);

    const mine = await list(f, '?assignee=me&sort=-title');
    expect(mine.json.data.map((t: { title: string }) => t.title)).toEqual(['C elsewhere', 'B doing']);
  });

  it('404s an unknown or archived projectId instead of an empty list', async () => {
    const f = await apiFixture('k6b');
    const old = await createProject(f.ctx, { name: 'Old' });
    if (!old.ok) throw new Error();
    await archiveProject(f.ctx, { projectId: old.data.id });

    for (const projectId of ['nope', old.data.id]) {
      const res = await list(f, `?projectId=${projectId}`);
      expect(res.status, projectId).toBe(404);
      expect(res.json.error).toEqual({ code: 'not_found', message: 'Project not found.' });
    }
  });

  it('rejects filter values the list would otherwise drop', async () => {
    const f = await apiFixture('k7');
    for (const qs of ['?priority=hihg', '?due=tomorow', '?state=closed', '?sort=rank', `?status=${f.statuses[0].id}`, '?limit=0', '?limit=101']) {
      const res = await list(f, qs);
      expect(res.status, qs).toBe(400);
      expect(res.json.error.code).toBe('invalid_request');
    }
  });

  it('rejects a misspelled parameter name instead of ignoring it', async () => {
    const f = await apiFixture('k7b');
    for (const qs of ['?assigne=me', '?label=x', '?project=x']) {
      const res = await list(f, qs);
      expect(res.status, qs).toBe(400);
      expect(res.json.error.issues[0].path, qs).toBe('query');
    }
  });

  it('rejects id filters the list would drop: too many, too long, blank, created=none', async () => {
    const f = await apiFixture('k7c');
    const many = Array.from({ length: 51 }, (_, i) => `l${i}`).join(',');
    for (const [qs, field] of [
      [`?labels=${many}`, 'labels'], [`?assignee=${'x'.repeat(65)}`, 'assignee'], ['?assignee=%20', 'assignee'], ['?created=none', 'created'],
    ]) {
      const res = await list(f, qs);
      expect(res.status, qs).toBe(400);
      expect(res.json.error.issues.map((i: { path: string }) => i.path), qs).toContain(`query.${field}`);
    }
  });

  it('pages with an opaque cursor', async () => {
    const f = await apiFixture('k8');
    for (const t of ['A', 'B', 'C', 'D', 'E']) await add(f.ctx, { projectId: f.project.id, title: t });

    const p1 = await list(f, '?sort=title&limit=2');
    const p2 = await list(f, `?sort=title&limit=2&cursor=${p1.json.nextCursor}`);
    const p3 = await list(f, `?sort=title&limit=2&cursor=${p2.json.nextCursor}`);

    expect([p1, p2, p3].map((p) => p.json.data.map((t: { title: string }) => t.title))).toEqual([['A', 'B'], ['C', 'D'], ['E']]);
    expect(p3.json.nextCursor).toBeNull();
  });

  it('cursor: 400 for garbage, empty last page past the end', async () => {
    const f = await apiFixture('k9');
    await add(f.ctx, { projectId: f.project.id, title: 'Only' });

    expect((await list(f, '?cursor=%%%')).status).toBe(400);
    expect((await list(f, '?cursor=bm9wZQ')).status).toBe(400); // base64url of "nope"
    const far = Buffer.from('500').toString('base64url');
    const res = await list(f, `?cursor=${far}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: [], nextCursor: null });
  });
});

describe('GET /tasks/{taskId}', () => {
  it('returns the task with description and labels', async () => {
    const f = await apiFixture('k10');
    const bug = await createLabel(f.ctx, { name: 'Bug' });
    if (!bug.ok) throw new Error();
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T', description: '**hi**', labelIds: [bug.data.id] });

    const res = await one(f, id);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id, description: '**hi**', labels: [{ id: bug.data.id, name: 'Bug' }] });
  });

  it('404s another workspace’s task and a task in an archived project', async () => {
    const f = await apiFixture('k11');
    const g = await apiFixture('k11b');
    const foreign = await add(g.ctx, { projectId: g.project.id, title: 'Theirs' });
    const mine = await add(f.ctx, { projectId: f.project.id, title: 'Mine' });
    await archiveProject(f.ctx, { projectId: f.project.id });

    expect((await one(f, foreign)).status).toBe(404);
    expect((await one(f, mine)).status).toBe(404);
    expect((await one(f, mine, { method: 'PATCH', body: { title: 'x' } })).status).toBe(404);
    expect((await one(f, mine, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('PATCH /tasks/{taskId}', () => {
  it('moves a task to Done with a status activity row by the token owner', async () => {
    const f = await apiFixture('k12');
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T' });
    const before = await version(f.ws.id);

    const res = await one(f, id, { method: 'PATCH', body: { statusId: f.statuses[2].id } });

    expect(res.status).toBe(200);
    expect(res.json.status).toEqual({ id: f.statuses[2].id, name: 'Done', isDone: true });
    const rows = await db.select().from(taskActivity).where(and(eq(taskActivity.taskId, id), eq(taskActivity.kind, 'status')));
    expect(rows).toEqual([expect.objectContaining({ actorId: f.ada.id, fromValue: 'Todo', toValue: 'Done' })]);
    expect(await version(f.ws.id)).toBeGreaterThan(before);
  });

  it('sets labels alone', async () => {
    const f = await apiFixture('k13');
    const bug = await createLabel(f.ctx, { name: 'Bug' });
    if (!bug.ok) throw new Error();
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T' });

    const res = await one(f, id, { method: 'PATCH', body: { labelIds: [bug.data.id] } });

    expect(res.json.labels).toEqual([{ id: bug.data.id, name: 'Bug' }]);
  });

  it('bumps updatedAt on a labels-only change', async () => {
    const f = await apiFixture('k13b');
    const bug = await createLabel(f.ctx, { name: 'Bug' });
    if (!bug.ok) throw new Error();
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T' });
    await db.update(task).set({ updatedAt: new Date('2020-01-01T00:00:00Z') }).where(eq(task.id, id));

    const res = await one(f, id, { method: 'PATCH', body: { labelIds: [bug.data.id] } });

    expect(new Date(res.json.updatedAt).getTime()).toBeGreaterThan(Date.parse('2020-01-02'));
  });

  it('changes nothing when a label id is unknown', async () => {
    const f = await apiFixture('k14');
    const id = await add(f.ctx, { projectId: f.project.id, title: 'Before' });

    const res = await one(f, id, { method: 'PATCH', body: { title: 'After', labelIds: ['nope'] } });

    expect(res.status).toBe(422);
    const [row] = await db.select().from(task).where(eq(task.id, id));
    expect(row.title).toBe('Before');
  });

  it('400s an empty body; 422s a status of another project', async () => {
    const f = await apiFixture('k15');
    const other = await createProject(f.ctx, { name: 'App' });
    if (!other.ok) throw new Error();
    const foreignStatus = (await getProject(f.ctx, other.data.id))!.statuses[0].id;
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T' });

    expect((await one(f, id, { method: 'PATCH', body: {} })).status).toBe(400);
    const typo = await one(f, id, { method: 'PATCH', body: { statusId: f.statuses[2].id, assignee: 'me' } });
    expect(typo.status).toBe(400);
    expect((await one(f, id)).json.status.id).toBe(f.statuses[0].id);
    const moved = await one(f, id, { method: 'PATCH', body: { statusId: foreignStatus } });
    expect(moved.status).toBe(422);
    expect(moved.json.error.message).toBe('That column does not belong to this project.');
  });
});

describe('DELETE /tasks/{taskId}', () => {
  it('deletes, answers 204, bumps the stamp; a second delete 404s', async () => {
    const f = await apiFixture('k16');
    const id = await add(f.ctx, { projectId: f.project.id, title: 'T' });
    const before = await version(f.ws.id);

    expect((await one(f, id, { method: 'DELETE' })).status).toBe(204);
    expect(await db.select().from(task).where(eq(task.id, id))).toHaveLength(0);
    expect(await version(f.ws.id)).toBeGreaterThan(before);
    expect((await one(f, id, { method: 'DELETE' })).status).toBe(404);
  });
});
