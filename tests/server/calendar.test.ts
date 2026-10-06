import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { task, workspaceSettings } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { getWeekStart } from '@/server/settings/queries';
import { listCalendarTasks } from '@/server/tasks/calendar';
import { createTask } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const RANGE = { from: '2026-09-28', to: '2026-11-08' };

async function setup(slug = 'ws-cal') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const p1 = await createProject(ctx, { name: 'Web' });
  const p2 = await createProject(ctx, { name: 'App' });
  if (!p1.ok || !p2.ok) throw new Error();
  return { ctx, ws, p1: p1.data.id, p2: p2.data.id };
}

async function add(ctx: WorkspaceContext, projectId: string, title: string, dueDate: string | null, assigneeId?: string) {
  const made = await createTask(ctx, { projectId, title, dueDate, assigneeId });
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

describe('listCalendarTasks', () => {
  it('returns a project’s dated tasks inside the range, by date', async () => {
    const { ctx, p1, p2 } = await setup();
    await add(ctx, p1, 'B', '2026-10-05');
    await add(ctx, p1, 'A', '2026-10-01');
    await add(ctx, p1, 'Undated', null);
    await add(ctx, p1, 'Outside', '2026-12-01');
    await add(ctx, p2, 'Other project', '2026-10-02');

    const rows = await listCalendarTasks(ctx, { ...RANGE, projectId: p1 });

    expect(rows.map((r) => [r.title, r.dueDate])).toEqual([['A', '2026-10-01'], ['B', '2026-10-05']]);
    expect(rows[0]).toMatchObject({ projectId: p1, projectName: 'Web', isDone: false });
  });

  it('includes the range edges', async () => {
    const { ctx, p1 } = await setup();
    await add(ctx, p1, 'First', '2026-09-28');
    await add(ctx, p1, 'Last', '2026-11-08');
    expect(await listCalendarTasks(ctx, { ...RANGE, projectId: p1 })).toHaveLength(2);
  });

  it('“mine” spans projects but only my assigned tasks, and skips archived projects and tasks', async () => {
    const { ctx, ws, p1, p2 } = await setup();
    const bob = await createUser('bob-cal@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    await add(ctx, p1, 'Mine 1', '2026-10-01', ctx.userId);
    await add(ctx, p2, 'Mine 2', '2026-10-02', ctx.userId);
    await add(ctx, p1, 'Bob’s', '2026-10-03', bob.id);
    const archived = await add(ctx, p1, 'Archived', '2026-10-04', ctx.userId);
    await db.update(task).set({ archivedAt: new Date() }).where(eq(task.id, archived));

    expect((await listCalendarTasks(ctx, { ...RANGE, mine: true })).map((r) => r.title)).toEqual(['Mine 1', 'Mine 2']);

    await archiveProject(ctx, { projectId: p2 });
    expect((await listCalendarTasks(ctx, { ...RANGE, mine: true })).map((r) => r.title)).toEqual(['Mine 1']);
  });

  it('marks done tasks', async () => {
    const { ctx, p1 } = await setup();
    const statuses = (await getProject(ctx, p1))!.statuses;
    const done = statuses.find((s) => s.isDone)!;
    await createTask(ctx, { projectId: p1, title: 'Done', dueDate: '2026-10-01', statusId: done.id });

    const [row] = await listCalendarTasks(ctx, { ...RANGE, projectId: p1 });

    expect(row.isDone).toBe(true);
  });

  it('never returns another workspace’s project', async () => {
    const a = await setup('ws-cal-a');
    const b = await setup('ws-cal-b');
    await add(b.ctx, b.p1, 'Theirs', '2026-10-01');

    expect(await listCalendarTasks(a.ctx, { ...RANGE, projectId: b.p1 })).toEqual([]);
  });

  it.each([
    { from: '2026-10-01', to: '2026-11-20' },
    { from: '2026-10-10', to: '2026-10-01' },
    { from: 'bad', to: '2026-10-01' },
  ])('rejects range %j', async (range) => {
    const { ctx, p1 } = await setup();
    await expect(listCalendarTasks(ctx, { ...range, projectId: p1 })).rejects.toThrow(RangeError);
  });
});

describe('getWeekStart', () => {
  it('reads the workspace setting', async () => {
    const { ctx, ws } = await setup();
    expect(await getWeekStart(ctx)).toBe(1);
    await db.update(workspaceSettings).set({ weekStart: 0 }).where(eq(workspaceSettings.workspaceId, ws.id));
    expect(await getWeekStart(ctx)).toBe(0);
  });
});
