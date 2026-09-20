import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { getProject, listProjects } from '@/server/projects/queries';
import { archiveProject, createProject, deleteProject } from '@/server/projects/service';
import { task, taskStatus } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function ctxFor(email: string, slug: string): Promise<WorkspaceContext> {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  return {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
}

describe('createProject', () => {
  it('creates a project with three default statuses in order', async () => {
    const ctx = await ctxFor('ada@example.com', 'acme');

    const result = await createProject(ctx, { name: 'Website' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const statuses = await db
      .select().from(taskStatus)
      .where(eq(taskStatus.projectId, result.data.id))
      .orderBy(taskStatus.position);

    expect(statuses.map((s) => s.name)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(statuses.map((s) => s.isDone)).toEqual([false, false, true]);
  });

  it('rejects an empty name', async () => {
    const ctx = await ctxFor('ada2@example.com', 'acme2');
    const result = await createProject(ctx, { name: '   ' });
    expect(result.ok).toBe(false);
  });

  it('disambiguates a duplicate slug within the workspace', async () => {
    const ctx = await ctxFor('ada3@example.com', 'acme3');
    await createProject(ctx, { name: 'Website' });
    const second = await createProject(ctx, { name: 'Website' });

    expect(second.ok).toBe(true);
    const projects = await listProjects(ctx);
    expect(new Set(projects.map((p) => p.slug)).size).toBe(2);
  });

  it('allows the same project name in two different workspaces', async () => {
    const a = await ctxFor('a@example.com', 'ws-a');
    const b = await ctxFor('b@example.com', 'ws-b');

    expect((await createProject(a, { name: 'Website' })).ok).toBe(true);
    expect((await createProject(b, { name: 'Website' })).ok).toBe(true);
  });
});

describe('listProjects', () => {
  it('returns only this workspace’s projects', async () => {
    const a = await ctxFor('a2@example.com', 'ws-a2');
    const b = await ctxFor('b2@example.com', 'ws-b2');
    await createProject(a, { name: 'Ada Project' });
    await createProject(b, { name: 'Bob Project' });

    const forA = await listProjects(a);
    expect(forA).toHaveLength(1);
    expect(forA[0].name).toBe('Ada Project');
  });

  it('excludes archived projects', async () => {
    const ctx = await ctxFor('ada4@example.com', 'acme4');
    const created = await createProject(ctx, { name: 'Old' });
    if (!created.ok) throw new Error('setup failed');

    await archiveProject(ctx, { projectId: created.data.id });
    expect(await listProjects(ctx)).toHaveLength(0);
  });
});

describe('getProject', () => {
  it('returns null for a project in another workspace', async () => {
    const a = await ctxFor('a3@example.com', 'ws-a3');
    const b = await ctxFor('b3@example.com', 'ws-b3');
    const created = await createProject(b, { name: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    // The id is correct and exists; only the workspace differs. This is the
    // cross-tenant read the whole boundary exists to stop.
    expect(await getProject(a, created.data.id)).toBeNull();
  });
});

describe('deleteProject', () => {
  it('refuses when the caller is a plain member', async () => {
    const ctx = await ctxFor('ada5@example.com', 'acme5');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');

    const asMember = { ...ctx, role: 'member' as const };
    const result = await deleteProject(asMember, { projectId: created.data.id });
    expect(result.ok).toBe(false);
  });

  it('deletes tasks then statuses then the project without tripping RESTRICT', async () => {
    const ctx = await ctxFor('ada6@example.com', 'acme6');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');

    const detail = await getProject(ctx, created.data.id);
    await db.insert(task).values({
      id: 'task-to-delete', workspaceId: ctx.workspaceId, projectId: created.data.id,
      title: 'Doomed', statusId: detail!.statuses[0].id, position: 'a0', createdBy: ctx.userId,
    });

    const result = await deleteProject(ctx, { projectId: created.data.id });

    expect(result.ok).toBe(true);
    expect(await db.select().from(task)).toHaveLength(0);
    expect(await db.select().from(taskStatus)).toHaveLength(0);
  });

  it('refuses to delete a project in another workspace', async () => {
    const a = await ctxFor('a4@example.com', 'ws-a4');
    const b = await ctxFor('b4@example.com', 'ws-b4');
    const created = await createProject(b, { name: 'Private' });
    if (!created.ok) throw new Error('setup failed');

    const result = await deleteProject(a, { projectId: created.data.id });
    expect(result.ok).toBe(false);
    expect(await db.select().from(taskStatus)).not.toHaveLength(0);
  });
});
