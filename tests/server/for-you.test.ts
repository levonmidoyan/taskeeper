import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { createComment } from '@/server/comments/service';
import { getProject, listProjects } from '@/server/projects/queries';
import { archiveProject, createProject, setProjectStar } from '@/server/projects/service';
import { listRecentTasks } from '@/server/tasks/queries';
import { createTask, updateTask } from '@/server/tasks/service';
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
  return { ctx, projectId: created.data.id };
}

async function teammate(ctx: WorkspaceContext, email: string): Promise<WorkspaceContext> {
  const user = await createUser(email);
  await joinWorkspace(user.id, ctx.workspaceId, 'member');
  return { ...ctx, userId: user.id, role: 'member' };
}

describe('setProjectStar', () => {
  it('stars and unstars for the caller only', async () => {
    const { ctx, projectId } = await setup('ada@example.com', 'acme');
    const bob = await teammate(ctx, 'bob@example.com');

    expect((await setProjectStar(ctx, { projectId, starred: true })).ok).toBe(true);
    // Twice is fine: a stale button must not fail.
    expect((await setProjectStar(ctx, { projectId, starred: true })).ok).toBe(true);

    expect((await listProjects(ctx))[0].starred).toBe(true);
    expect((await getProject(ctx, projectId))!.starred).toBe(true);
    expect((await listProjects(bob))[0].starred).toBe(false);

    await setProjectStar(ctx, { projectId, starred: false });
    expect((await listProjects(ctx))[0].starred).toBe(false);
  });

  it('does not change the open task count', async () => {
    const { ctx, projectId } = await setup('ada2@example.com', 'acme2');
    await createTask(ctx, { projectId, title: 'One' });
    await createTask(ctx, { projectId, title: 'Two' });
    await setProjectStar(ctx, { projectId, starred: true });

    expect((await listProjects(ctx))[0].openTaskCount).toBe(2);
  });

  it('refuses a project from another workspace', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    const result = await setProjectStar(a.ctx, { projectId: b.projectId, starred: true });
    expect(result.ok).toBe(false);
  });
});

describe('listRecentTasks', () => {
  it('lists tasks the caller created, changed or commented on, newest touch first', async () => {
    const { ctx, projectId } = await setup('ada3@example.com', 'acme3');
    const bob = await teammate(ctx, 'bob3@example.com');

    const mine = await createTask(ctx, { projectId, title: 'Mine' });
    const bobs = await createTask(bob, { projectId, title: 'Bobs' });
    const untouched = await createTask(bob, { projectId, title: 'Untouched' });
    if (!mine.ok || !bobs.ok || !untouched.ok) throw new Error('setup failed');

    // Pin the creation times so the order does not depend on clock resolution.
    await db.update(task).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(task.id, mine.data.id));
    await createComment(ctx, { taskId: bobs.data.id, body: 'On it' });

    const recent = await listRecentTasks(ctx);
    expect(recent.map((r) => r.title)).toEqual(['Bobs', 'Mine']);
    expect(recent[0].projectName).toBe('Website');
    expect(recent[0].touchedAt).toBeInstanceOf(Date);

    await updateTask(ctx, { taskId: mine.data.id, title: 'Mine, renamed' });
    expect((await listRecentTasks(ctx))[0].title).toBe('Mine, renamed');
  });

  it('drops archived projects and never reads another workspace', async () => {
    const a = await setup('a4@example.com', 'ws-a4');
    const b = await setup('b4@example.com', 'ws-b4');
    await createTask(a.ctx, { projectId: a.projectId, title: 'A task' });
    await createTask(b.ctx, { projectId: b.projectId, title: 'B task' });

    expect((await listRecentTasks(a.ctx)).map((r) => r.title)).toEqual(['A task']);

    await archiveProject(a.ctx, { projectId: a.projectId });
    expect(await listRecentTasks(a.ctx)).toEqual([]);
  });
});
