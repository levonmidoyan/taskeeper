import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { reminder } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { listMyReminders, setTaskReminders } from '@/server/reminders/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

function ctxFor(userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext {
  return { userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC' };
}

async function setup(slug = 'ws-rem') {
  const ada = await createUser(`${slug}-ada@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx = ctxFor(ada.id, ws);
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T', dueDate: '2026-10-10' });
  if (!made.ok) throw new Error();
  return { ctx, ws, taskId: made.data.id };
}

describe('setTaskReminders', () => {
  it('saves my offsets sorted and de-duplicated, and reads them back', async () => {
    const { ctx, taskId } = await setup();

    const result = await setTaskReminders(ctx, { taskId, offsets: [7, 1, 1] });

    expect(result).toEqual({ ok: true, data: [1, 7] });
    expect(await listMyReminders(ctx, taskId)).toEqual([1, 7]);
  });

  it('two saves at once both succeed, and one of the two sets is what is stored', async () => {
    const { ctx, taskId } = await setup();

    const results = await Promise.all([
      setTaskReminders(ctx, { taskId, offsets: [0, 1] }),
      setTaskReminders(ctx, { taskId, offsets: [0, 1, 7] }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect([[0, 1], [0, 1, 7]]).toContainEqual(await listMyReminders(ctx, taskId));
  });

  it('replaces my previous set', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0, 1] });

    await setTaskReminders(ctx, { taskId, offsets: [2] });

    expect(await listMyReminders(ctx, taskId)).toEqual([2]);
  });

  it('an empty list clears mine', async () => {
    const { ctx, taskId } = await setup();
    await setTaskReminders(ctx, { taskId, offsets: [0] });

    await setTaskReminders(ctx, { taskId, offsets: [] });

    expect(await db.select().from(reminder)).toEqual([]);
  });

  it('leaves a teammate’s reminders on the same task alone', async () => {
    const { ctx, ws, taskId } = await setup();
    const bob = await createUser('bob-rem@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    const bobCtx = ctxFor(bob.id, ws, 'member');
    await setTaskReminders(bobCtx, { taskId, offsets: [1] });

    await setTaskReminders(ctx, { taskId, offsets: [0] });
    await setTaskReminders(ctx, { taskId, offsets: [] });

    expect(await listMyReminders(bobCtx, taskId)).toEqual([1]);
    expect(await listMyReminders(ctx, taskId)).toEqual([]);
  });

  it('takes the user from the context, never from input', async () => {
    const { ctx, taskId } = await setup();

    await setTaskReminders(ctx, { taskId, offsets: [1], userId: 'someone-else' } as never);

    const [row] = await db.select().from(reminder);
    expect(row.userId).toBe(ctx.userId);
    expect(row.workspaceId).toBe(ctx.workspaceId);
  });

  it('rejects an offset that is not offered', async () => {
    const { ctx, taskId } = await setup();
    const result = await setTaskReminders(ctx, { taskId, offsets: [3] });
    expect(result).toEqual({ ok: false, error: 'Pick from the offered reminder times.' });
    expect(await db.select().from(reminder)).toEqual([]);
  });

  it('refuses a task from another workspace', async () => {
    const a = await setup('ws-rem-a');
    const b = await setup('ws-rem-b');

    const result = await setTaskReminders(a.ctx, { taskId: b.taskId, offsets: [1] });

    expect(result).toEqual({ ok: false, error: 'Task not found.' });
    expect(await listMyReminders(a.ctx, b.taskId)).toEqual([]);
  });
});
