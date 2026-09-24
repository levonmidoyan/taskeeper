import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { getProject } from '@/server/projects/queries';
import { createProject } from '@/server/projects/service';
import { createStatus, deleteStatus, moveStatus, updateStatus } from '@/server/statuses/service';
import { createTask, updateTask } from '@/server/tasks/service';
import { getTask, listProjectTasks } from '@/server/tasks/queries';
import { task } from '@/db';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, created.data.id);
  return { ctx, workspace: ws, projectId: created.data.id, statuses: detail!.statuses };
}

const names = async (ctx: WorkspaceContext, projectId: string) =>
  (await getProject(ctx, projectId))!.statuses.map((s) => s.name);

describe('createStatus', () => {
  it('appends a column to the end of the board', async () => {
    const { ctx, projectId } = await setup('ada@example.com', 'acme');

    const result = await createStatus(ctx, { projectId, name: 'Review' });

    expect(result.ok).toBe(true);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'In Progress', 'Done', 'Review']);
  });

  it('rejects an empty name', async () => {
    const { ctx, projectId } = await setup('ada2@example.com', 'acme2');
    expect((await createStatus(ctx, { projectId, name: '   ' })).ok).toBe(false);
  });

  it('refuses a project in another workspace', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    const result = await createStatus(b.ctx, { projectId: a.projectId, name: 'Sneaky' });

    expect(result).toEqual({ ok: false, error: 'Project not found.' });
    expect(await names(a.ctx, a.projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('caps the number of columns', async () => {
    const { ctx, projectId } = await setup('ada3@example.com', 'acme3');
    for (let i = 0; i < 9; i += 1) {
      expect((await createStatus(ctx, { projectId, name: `Extra ${i}` })).ok).toBe(true);
    }
    const overflow = await createStatus(ctx, { projectId, name: 'One too many' });
    expect(overflow.ok).toBe(false);
  });

  it('is refused to a plain member', async () => {
    const { ctx, workspace, projectId } = await setup('ada4@example.com', 'acme4');
    const other = await createUser('mem@example.com');
    await joinWorkspace(other.id, workspace.id, 'member');

    const result = await createStatus(
      { ...ctx, userId: other.id, role: 'member' },
      { projectId, name: 'Review' },
    );

    expect(result.ok).toBe(false);
    expect(await names(ctx, projectId)).toHaveLength(3);
  });
});

describe('updateStatus', () => {
  it('renames a column', async () => {
    const { ctx, projectId, statuses } = await setup('ada5@example.com', 'acme5');

    const result = await updateStatus(ctx, { statusId: statuses[0].id, name: '  Backlog  ' });

    expect(result.ok).toBe(true);
    expect(await names(ctx, projectId)).toEqual(['Backlog', 'In Progress', 'Done']);
  });

  it('refuses a column in another workspace', async () => {
    const a = await setup('a2@example.com', 'ws-a2');
    const b = await setup('b2@example.com', 'ws-b2');

    const result = await updateStatus(b.ctx, { statusId: a.statuses[0].id, name: 'Hijacked' });

    expect(result).toEqual({ ok: false, error: 'Column not found.' });
    expect(await names(a.ctx, a.projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('completes the tasks already sitting in a column turned done', async () => {
    const { ctx, projectId, statuses } = await setup('ada6@example.com', 'acme6');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('setup failed');

    expect((await updateStatus(ctx, { statusId: statuses[0].id, isDone: true })).ok).toBe(true);

    const [row] = await db.select().from(task).where(eq(task.id, created.data.id));
    expect(row.completedAt).not.toBeNull();
  });

  it('clears completion when a done column becomes an open one', async () => {
    const { ctx, projectId, statuses } = await setup('ada7@example.com', 'acme7');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('setup failed');
    // Through updateTask, so the task really carries a completed_at to clear.
    expect((await updateTask(ctx, { taskId: created.data.id, statusId: statuses[2].id })).ok).toBe(true);
    expect((await getTask(ctx, created.data.id))!.completedAt).not.toBeNull();

    expect((await updateStatus(ctx, { statusId: statuses[2].id, isDone: false })).ok).toBe(false);

    // Only refused because Done is the project's one done column; add another
    // and the flip goes through, taking the task's completion with it.
    expect((await updateStatus(ctx, { statusId: statuses[1].id, isDone: true })).ok).toBe(true);
    expect((await updateStatus(ctx, { statusId: statuses[2].id, isDone: false })).ok).toBe(true);

    const detail = await getTask(ctx, created.data.id);
    expect(detail!.completedAt).toBeNull();
  });

  it('refuses to leave the project with no open column', async () => {
    const { ctx, statuses } = await setup('ada8@example.com', 'acme8');

    expect((await updateStatus(ctx, { statusId: statuses[0].id, isDone: true })).ok).toBe(true);
    expect((await updateStatus(ctx, { statusId: statuses[1].id, isDone: true })).ok).toBe(false);
  });
});

describe('moveStatus', () => {
  it('reorders a column between its new neighbours', async () => {
    const { ctx, projectId, statuses } = await setup('ada9@example.com', 'acme9');

    // Move "Done" to the front.
    const result = await moveStatus(ctx, {
      statusId: statuses[2].id, beforeId: null, afterId: statuses[0].id,
    });

    expect(result.ok).toBe(true);
    expect(await names(ctx, projectId)).toEqual(['Done', 'Todo', 'In Progress']);
  });

  it('refuses a neighbour from another project', async () => {
    const { ctx, projectId, statuses } = await setup('ada10@example.com', 'acme10');
    const other = await createProject(ctx, { name: 'Other' });
    if (!other.ok) throw new Error('setup failed');
    const otherStatuses = (await getProject(ctx, other.data.id))!.statuses;

    const result = await moveStatus(ctx, {
      statusId: statuses[0].id, beforeId: null, afterId: otherStatuses[0].id,
    });

    expect(result.ok).toBe(false);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('is refused to a plain member', async () => {
    const { ctx, workspace, projectId, statuses } = await setup('ada11@example.com', 'acme11');
    const other = await createUser('mem2@example.com');
    await joinWorkspace(other.id, workspace.id, 'member');

    const result = await moveStatus(
      { ...ctx, userId: other.id, role: 'member' },
      { statusId: statuses[2].id, beforeId: null, afterId: statuses[0].id },
    );

    expect(result.ok).toBe(false);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });
});

describe('deleteStatus', () => {
  it('deletes an empty column', async () => {
    const { ctx, projectId, statuses } = await setup('ada12@example.com', 'acme12');

    expect((await deleteStatus(ctx, { statusId: statuses[1].id })).ok).toBe(true);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'Done']);
  });

  it('refuses a column holding tasks when no destination is named', async () => {
    const { ctx, projectId, statuses } = await setup('ada13@example.com', 'acme13');
    expect((await createTask(ctx, { projectId, title: 'Ship v1' })).ok).toBe(true);

    const result = await deleteStatus(ctx, { statusId: statuses[0].id });

    expect(result.ok).toBe(false);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('moves the tasks to the named column, in order, and deletes it', async () => {
    const { ctx, projectId, statuses } = await setup('ada14@example.com', 'acme14');
    for (const title of ['One', 'Two', 'Three']) {
      expect((await createTask(ctx, { projectId, title })).ok).toBe(true);
    }

    const result = await deleteStatus(ctx, {
      statusId: statuses[0].id, reassignToId: statuses[1].id,
    });

    expect(result.ok).toBe(true);
    expect(await names(ctx, projectId)).toEqual(['In Progress', 'Done']);

    const moved = (await listProjectTasks(ctx, projectId))
      .filter((t) => t.statusId === statuses[1].id);
    expect(moved.map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('completes the tasks it moves into a done column', async () => {
    const { ctx, projectId, statuses } = await setup('ada15@example.com', 'acme15');
    const created = await createTask(ctx, { projectId, title: 'Ship v1' });
    if (!created.ok) throw new Error('setup failed');

    const result = await deleteStatus(ctx, {
      statusId: statuses[0].id, reassignToId: statuses[2].id,
    });

    expect(result.ok).toBe(true);
    expect((await getTask(ctx, created.data.id))!.completedAt).not.toBeNull();
  });

  it('refuses a destination in another project', async () => {
    const { ctx, projectId, statuses } = await setup('ada16@example.com', 'acme16');
    expect((await createTask(ctx, { projectId, title: 'Ship v1' })).ok).toBe(true);
    const other = await createProject(ctx, { name: 'Other' });
    if (!other.ok) throw new Error('setup failed');
    const otherStatuses = (await getProject(ctx, other.data.id))!.statuses;

    const result = await deleteStatus(ctx, {
      statusId: statuses[0].id, reassignToId: otherStatuses[0].id,
    });

    expect(result.ok).toBe(false);
    expect(await names(ctx, projectId)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('refuses to remove the last done column', async () => {
    const { ctx, statuses } = await setup('ada17@example.com', 'acme17');
    const result = await deleteStatus(ctx, { statusId: statuses[2].id });
    expect(result.ok).toBe(false);
  });

  it('refuses a column in another workspace', async () => {
    const a = await setup('a3@example.com', 'ws-a3');
    const b = await setup('b3@example.com', 'ws-b3');

    const result = await deleteStatus(b.ctx, { statusId: a.statuses[1].id });

    expect(result).toEqual({ ok: false, error: 'Column not found.' });
    expect(await names(a.ctx, a.projectId)).toHaveLength(3);
  });
});
