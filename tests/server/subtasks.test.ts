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
