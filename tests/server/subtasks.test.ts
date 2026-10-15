import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { createTask, updateTask } from '@/server/tasks/service';
import { getTaskDetail } from '@/server/tasks/queries';
import { createSubtasks, reorderSubtask } from '@/server/tasks/subtasks';
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

async function make(ctx: WorkspaceContext, projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const r = await createTask(ctx, { projectId, title, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe('subtask order', () => {
  it('appends each new subtask after its last sibling', async () => {
    const { ctx, projectId } = await setup('o1@example.com', 'o1');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    await make(ctx, projectId, 'C', { parentTaskId: parent });

    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['A', 'B', 'C']);
    const rows = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.parentTaskId, parent));
    expect(rows.every((r) => r.p !== null)).toBe(true);
  });

  it('leaves top-level tasks without a subtask position', async () => {
    const { ctx, projectId } = await setup('o2@example.com', 'o2');
    const id = await make(ctx, projectId, 'Top');
    const [row] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, id));
    expect(row.p).toBeNull();
  });

  it('keeps a subtask in place when its status changes', async () => {
    const { ctx, projectId, statuses } = await setup('o3@example.com', 'o3');
    const parent = await make(ctx, projectId, 'Parent');
    const a = await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    const done = statuses.find((s) => s.isDone)!;

    expect((await updateTask(ctx, { taskId: a, statusId: done.id })).ok).toBe(true);
    expect((await updateTask(ctx, { taskId: a, statusId: statuses[0].id })).ok).toBe(true);

    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('gives concurrent subtask creates distinct positions', async () => {
    const { ctx, projectId } = await setup('o4@example.com', 'o4');
    const parent = await make(ctx, projectId, 'Parent');
    await Promise.all(Array.from({ length: 6 }, (_, i) => make(ctx, projectId, `S${i}`, { parentTaskId: parent })));
    const rows = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.parentTaskId, parent));
    expect(new Set(rows.map((r) => r.p)).size).toBe(6);
  });

  it('backfill copies board keys into subtask order, keeping the displayed order', async () => {
    const { ctx, projectId } = await setup('o6@example.com', 'o6');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'A', { parentTaskId: parent });
    await make(ctx, projectId, 'B', { parentTaskId: parent });
    await db.update(task).set({ subtaskPosition: null }).where(eq(task.parentTaskId, parent));

    const file = readFileSync(join(__dirname, '../../src/db/sql/subtask-position-backfill.sql'), 'utf8');
    await db.execute(sql.raw(file));
    await db.execute(sql.raw(file)); // safe to rerun

    expect((await getTaskDetail(ctx, parent))!.subtasks.map((s) => s.title)).toEqual(['A', 'B']);
    const [top] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, parent));
    expect(top.p).toBeNull();
  });

  it('refuses a subtask as a parent', async () => {
    const { ctx, projectId } = await setup('o5@example.com', 'o5');
    const parent = await make(ctx, projectId, 'Parent');
    const child = await make(ctx, projectId, 'Child', { parentTaskId: parent });
    const r = await createTask(ctx, { projectId, title: 'Grandchild', parentTaskId: child });
    expect(r).toEqual({ ok: false, error: 'Parent task not found.' });
  });
});

describe('getTaskDetail siblings', () => {
  it('lists siblings in subtask order, including the task itself, skipping archived ones', async () => {
    const { ctx, projectId } = await setup('s1@example.com', 's1');
    const parent = await make(ctx, projectId, 'Parent');
    const a = await make(ctx, projectId, 'A', { parentTaskId: parent });
    const b = await make(ctx, projectId, 'B', { parentTaskId: parent });
    const c = await make(ctx, projectId, 'C', { parentTaskId: parent });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, c));

    const detail = await getTaskDetail(ctx, b);
    expect(detail!.siblings).toEqual([{ id: a, title: 'A' }, { id: b, title: 'B' }]);
    expect((await getTaskDetail(ctx, parent))!.siblings).toEqual([]);
  });
});

describe('createSubtasks', () => {
  it('creates every title in order after existing subtasks', async () => {
    const { ctx, projectId } = await setup('c1@example.com', 'c1');
    const parent = await make(ctx, projectId, 'Parent');
    await make(ctx, projectId, 'First', { parentTaskId: parent });

    const r = await createSubtasks(ctx, { parentTaskId: parent, titles: ['  Two ', '', 'Three'] });

    expect(r.ok && r.data.ids).toHaveLength(2);
    const detail = await getTaskDetail(ctx, parent);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(['First', 'Two', 'Three']);
  });

  it('puts new subtasks in the parent’s column', async () => {
    const { ctx, projectId, statuses } = await setup('c2@example.com', 'c2');
    const parent = await make(ctx, projectId, 'Parent', { statusId: statuses[1].id });
    await createSubtasks(ctx, { parentTaskId: parent, titles: ['A'] });
    expect((await getTaskDetail(ctx, parent))!.subtasks[0].statusId).toBe(statuses[1].id);
  });

  it('rejects more than 50 titles and creates none', async () => {
    const { ctx, projectId } = await setup('c3@example.com', 'c3');
    const parent = await make(ctx, projectId, 'Parent');
    const r = await createSubtasks(ctx, { parentTaskId: parent, titles: Array.from({ length: 51 }, (_, i) => `T${i}`) });
    expect(r).toEqual({ ok: false, error: 'Up to 50 at a time.' });
    expect((await getTaskDetail(ctx, parent))!.subtasks).toHaveLength(0);
  });

  it('rejects an all-blank batch', async () => {
    const { ctx, projectId } = await setup('c4@example.com', 'c4');
    const parent = await make(ctx, projectId, 'Parent');
    expect((await createSubtasks(ctx, { parentTaskId: parent, titles: [' ', ''] })).ok).toBe(false);
  });

  it('refuses a subtask or foreign task as the parent', async () => {
    const a = await setup('c5@example.com', 'c5');
    const b = await setup('c6@example.com', 'c6');
    const parent = await make(a.ctx, a.projectId, 'Parent');
    const child = await make(a.ctx, a.projectId, 'Child', { parentTaskId: parent });
    expect((await createSubtasks(a.ctx, { parentTaskId: child, titles: ['X'] })).ok).toBe(false);
    expect((await createSubtasks(b.ctx, { parentTaskId: parent, titles: ['X'] })).ok).toBe(false);
  });
});

describe('reorderSubtask', () => {
  async function three(email: string, slug: string) {
    const s = await setup(email, slug);
    const parent = await make(s.ctx, s.projectId, 'Parent');
    const a = await make(s.ctx, s.projectId, 'A', { parentTaskId: parent });
    const b = await make(s.ctx, s.projectId, 'B', { parentTaskId: parent });
    const c = await make(s.ctx, s.projectId, 'C', { parentTaskId: parent });
    const order = async () => (await getTaskDetail(s.ctx, parent))!.subtasks.map((t) => t.title);
    return { ...s, parent, a, b, c, order };
  }

  it('moves a subtask between two siblings', async () => {
    const t = await three('r1@example.com', 'r1');
    expect((await reorderSubtask(t.ctx, { taskId: t.c, beforeId: t.a, afterId: t.b })).ok).toBe(true);
    expect(await t.order()).toEqual(['A', 'C', 'B']);
  });

  it('moves to either edge', async () => {
    const t = await three('r2@example.com', 'r2');
    await reorderSubtask(t.ctx, { taskId: t.c, beforeId: null, afterId: t.a });
    expect(await t.order()).toEqual(['C', 'A', 'B']);
    await reorderSubtask(t.ctx, { taskId: t.c, beforeId: t.b, afterId: null });
    expect(await t.order()).toEqual(['A', 'B', 'C']);
  });

  it('refuses reversed neighbours as stale', async () => {
    const t = await three('r3@example.com', 'r3');
    const r = await reorderSubtask(t.ctx, { taskId: t.a, beforeId: t.c, afterId: t.b });
    expect(r).toEqual({ ok: false, error: 'The list changed while you were dragging. Try again.' });
  });

  it('refuses a neighbour from another parent, or an archived one', async () => {
    const t = await three('r4@example.com', 'r4');
    const other = await make(t.ctx, t.projectId, 'Other');
    const stranger = await make(t.ctx, t.projectId, 'Stranger', { parentTaskId: other });
    expect(await reorderSubtask(t.ctx, { taskId: t.a, beforeId: stranger, afterId: null }))
      .toEqual({ ok: false, error: 'That move is not valid.' });
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, t.b));
    expect(await reorderSubtask(t.ctx, { taskId: t.a, beforeId: t.b, afterId: null }))
      .toEqual({ ok: false, error: 'That move is not valid.' });
  });

  it('refuses a top-level task', async () => {
    const t = await three('r5@example.com', 'r5');
    expect((await reorderSubtask(t.ctx, { taskId: t.parent, beforeId: null, afterId: null })).ok).toBe(false);
  });

  it('places between two siblings that share a key by renumbering', async () => {
    const t = await three('r6@example.com', 'r6');
    // Backfilled subtasks can tie: copy A's key onto B.
    const [rowA] = await db.select({ p: task.subtaskPosition }).from(task).where(eq(task.id, t.a));
    await db.update(task).set({ subtaskPosition: rowA.p }).where(eq(task.id, t.b));
    const [lo, hi] = [t.a, t.b].sort(); // ties read in id (codepoint) order
    const r = await reorderSubtask(t.ctx, { taskId: t.c, beforeId: lo, afterId: hi });
    expect(r.ok).toBe(true);
    const titles = await t.order();
    expect(titles.indexOf('C')).toBe(1);
  });
});
