import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion, pollWorkspaceVersion } from '@/server/changes/queries';
import { emitChange, emitChangeFor } from '@/server/changes/service';
import { PROJECT_COLOR_KEYS } from '@/components/brand/tint';
import type { Result } from '@/lib/result';
import { getProject } from '@/server/projects/queries';
import {
  archiveProject, createProject, deleteProject, renameProject, setProjectColor, setProjectStar, unarchiveProject,
} from '@/server/projects/service';
import { createStatus, deleteStatus, moveStatus, updateStatus } from '@/server/statuses/service';
import {
  bulkDeleteTasks, bulkUpdateTasks, createTask, deleteTask, moveTask, updateTask,
} from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(slug = 'acme') {
  const ada = await createUser(`${slug}@example.com`, 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: ada.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC',
  };
  return { ctx, ws, ada };
}

/** How far one call moved the counter. Also asserts whether the call succeeded. */
async function delta(ctx: WorkspaceContext, run: () => Promise<Result<unknown>>, expectOk = true): Promise<number> {
  const before = await getWorkspaceVersion(ctx);
  const result = await run();
  expect(result.ok, result.ok ? undefined : result.error).toBe(expectOk);
  return (await getWorkspaceVersion(ctx)) - before;
}

/** A workspace with one project (Todo / In Progress / Done) and one task in Todo. */
async function seeded(slug = 'acme') {
  const base = await setup(slug);
  const project = await createProject(base.ctx, { name: 'Website' });
  if (!project.ok) throw new Error(project.error);
  const statuses = (await getProject(base.ctx, project.data.id))!.statuses;
  const made = await createTask(base.ctx, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error(made.error);
  return { ...base, projectId: project.data.id, statuses, taskId: made.data.id };
}

describe('workspace change counter', () => {
  it('reads 0 before anything changed', async () => {
    const { ctx } = await setup();
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('goes up by one per emit, with or without a context', async () => {
    const { ctx } = await setup();
    await emitChange(ctx, {}, db);
    await emitChangeFor(ctx.workspaceId, db);
    expect(await getWorkspaceVersion(ctx)).toBe(2);
  });

  it('rolls back with the transaction it ran in', async () => {
    const { ctx } = await setup();
    await db
      .transaction(async (tx) => {
        await emitChange(ctx, { projectId: null }, tx);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await getWorkspaceVersion(ctx)).toBe(0);
  });

  it('keeps workspaces apart', async () => {
    const a = await setup('acme');
    const b = await setup('globex');
    await emitChange(a.ctx, {}, db);
    expect(await getWorkspaceVersion(b.ctx)).toBe(0);
  });
});

describe('pollWorkspaceVersion', () => {
  it('answers a member with the version', async () => {
    const { ctx, ada } = await setup();
    await emitChange(ctx, {}, db);
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(1);
  });

  it('answers 0 for a workspace that never changed', async () => {
    const { ada } = await setup();
    expect(await pollWorkspaceVersion(ada.id, 'acme')).toBe(0);
  });

  it('answers null to a non-member and for an unknown slug alike', async () => {
    await setup('acme');
    const { ada: outsider } = await setup('globex');
    expect(await pollWorkspaceVersion(outsider.id, 'acme')).toBeNull();
    expect(await pollWorkspaceVersion(outsider.id, 'nope')).toBeNull();
  });
});

describe('task writes bump the counter', () => {
  it('createTask', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: 'More' }))).toBe(1);
  });

  it('a refused create does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createTask(ctx, { projectId, title: '   ' }), false)).toBe(0);
  });

  it('updateTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => updateTask(ctx, { taskId, title: 'Renamed' }))).toBe(1);
  });

  it('moveTask', async () => {
    const { ctx, taskId, statuses } = await seeded();
    expect(await delta(ctx, () => moveTask(ctx, { taskId, statusId: statuses[1].id, beforeId: null, afterId: null }))).toBe(1);
  });

  it('deleteTask', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => deleteTask(ctx, { taskId }))).toBe(1);
  });

  it('bulkUpdateTasks bumps once for the whole set', async () => {
    const { ctx, projectId, taskId } = await seeded();
    const other = await createTask(ctx, { projectId, title: 'Other' });
    if (!other.ok) throw new Error(other.error);
    expect(await delta(ctx, () => bulkUpdateTasks(ctx, { taskIds: [taskId, other.data.id], patch: { priority: 'high' } }))).toBe(1);
  });

  it('bulkDeleteTasks', async () => {
    const { ctx, taskId } = await seeded();
    expect(await delta(ctx, () => bulkDeleteTasks(ctx, { taskIds: [taskId] }))).toBe(1);
  });
});

describe('column writes bump the counter', () => {
  it('createStatus', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => createStatus(ctx, { projectId, name: 'Review' }))).toBe(1);
  });

  it('updateStatus, but not an empty update', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id, name: 'Backlog' }))).toBe(1);
    expect(await delta(ctx, () => updateStatus(ctx, { statusId: statuses[0].id }))).toBe(0);
  });

  it('moveStatus', async () => {
    const { ctx, statuses } = await seeded();
    expect(await delta(ctx, () => moveStatus(ctx, { statusId: statuses[0].id, beforeId: statuses[2].id, afterId: null }))).toBe(1);
  });

  it('deleteStatus', async () => {
    const { ctx, statuses } = await seeded();
    // In Progress is empty; the seeded task sits in Todo.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[1].id }))).toBe(1);
  });

  it('a refused delete rolls back and does not bump', async () => {
    const { ctx, statuses } = await seeded();
    // Todo holds a task and no target is named.
    expect(await delta(ctx, () => deleteStatus(ctx, { statusId: statuses[0].id }), false)).toBe(0);
  });
});

describe('project writes bump the counter', () => {
  it('createProject', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => createProject(ctx, { name: 'Docs' }))).toBe(1);
  });

  it('rename, color, archive, unarchive, delete', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => renameProject(ctx, { projectId, name: 'Site' }))).toBe(1);
    expect(await delta(ctx, () => setProjectColor(ctx, { projectId, color: PROJECT_COLOR_KEYS[1] }))).toBe(1);
    expect(await delta(ctx, () => archiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => unarchiveProject(ctx, { projectId }))).toBe(1);
    expect(await delta(ctx, () => deleteProject(ctx, { projectId }))).toBe(1);
  });

  it('a rename of an unknown project does not', async () => {
    const { ctx } = await setup();
    expect(await delta(ctx, () => renameProject(ctx, { projectId: 'nope', name: 'X' }), false)).toBe(0);
  });

  it('starring is private and does not', async () => {
    const { ctx, projectId } = await seeded();
    expect(await delta(ctx, () => setProjectStar(ctx, { projectId, starred: true }))).toBe(0);
  });
});
