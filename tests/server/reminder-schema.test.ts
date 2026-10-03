import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { notification, reminder, task } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('rs@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-rs');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-rs', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T', dueDate: '2026-10-10' });
  if (!made.ok) throw new Error();
  return { ctx, taskId: made.data.id };
}

describe('reminder table', () => {
  it('rejects an offset outside 0, 1, 2, 7', async () => {
    const { ctx, taskId } = await setup();
    await expect(
      db.insert(reminder).values({ id: newId(), workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 3 }),
    ).rejects.toThrow();
  });

  it('allows one row per task, user and offset', async () => {
    const { ctx, taskId } = await setup();
    const row = { workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 1 };
    await db.insert(reminder).values({ id: newId(), ...row });
    await expect(db.insert(reminder).values({ id: newId(), ...row })).rejects.toThrow();
  });

  it('goes away with its task, and takes the task’s notifications with it', async () => {
    const { ctx, taskId } = await setup();
    await db.insert(reminder).values({ id: newId(), workspaceId: ctx.workspaceId, taskId, userId: ctx.userId, offsetDays: 0 });
    await db.insert(notification).values({
      id: newId(), userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'reminder', taskId,
      dedupeKey: 'rem:x', data: { title: 'T', projectName: 'P', dueDate: '2026-10-10', offsetDays: 0, daysLeft: 0 },
    });

    await db.delete(task).where(eq(task.id, taskId));

    expect(await db.select().from(reminder)).toEqual([]);
    expect(await db.select().from(notification)).toEqual([]);
  });
});

describe('notification table', () => {
  it('refuses a second row with the same dedupe key', async () => {
    const { ctx } = await setup();
    const row = {
      userId: ctx.userId, workspaceId: ctx.workspaceId, kind: 'digest' as const, dedupeKey: 'dig:same',
      data: { localDate: '2026-10-10', dueToday: 1, overdue: 0, tasks: [] },
    };
    await db.insert(notification).values({ id: newId(), ...row });
    await expect(db.insert(notification).values({ id: newId(), ...row })).rejects.toThrow();
  });
});
