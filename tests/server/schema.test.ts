import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { comment, organization, project, task, taskActivity, taskStatus, user } from '@/db';
import { newId } from '@/lib/ids';
import { positionBetween } from '@/lib/position';

beforeEach(resetDb);
afterAll(closeDb);

async function seedProject() {
  const userId = newId();
  const workspaceId = newId();
  const projectId = newId();
  const statusId = newId();

  await db.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` });
  await db.insert(organization).values({ id: workspaceId, name: 'Acme', slug: workspaceId });
  await db.insert(project).values({
    id: projectId, workspaceId, name: 'Website', slug: 'website', createdBy: userId,
  });
  await db.insert(taskStatus).values({
    id: statusId, projectId, name: 'Todo', position: positionBetween(null, null),
  });

  return { userId, workspaceId, projectId, statusId };
}

describe('schema', () => {
  it('stores a task and reads it back', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();

    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    const rows = await db.select().from(task);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Ship v1');
    expect(rows[0].priority).toBe('none');
    expect(rows[0].description).toBe('');
  });

  it('keeps due_date as a calendar string with no zone shift', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();

    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Due task', statusId,
      dueDate: '2026-09-21', position: positionBetween(null, null), createdBy: userId,
    });

    const [row] = await db.select().from(task);
    // If due_date were a timestamp, this would come back as the 20th for a
    // UTC-negative reader. It must be the exact string that was written.
    expect(row.dueDate).toBe('2026-09-21');
  });

  it('refuses to delete a status that still holds tasks', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Blocker', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await expect(
      db.execute(sql`DELETE FROM task_status WHERE id = ${statusId}`),
    ).rejects.toThrow();
  });

  it('cascades tasks when the workspace is deleted', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    await db.insert(task).values({
      id: newId(), workspaceId, projectId, title: 'Gone', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await db.execute(sql`DELETE FROM organization WHERE id = ${workspaceId}`);
    expect(await db.select().from(task)).toHaveLength(0);
  });
});

describe('comment and task_activity', () => {
  it('deletes a task\'s comments and activity with the task', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();
    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });
    await db.insert(comment).values({
      id: newId(), workspaceId, taskId, authorId: userId, body: 'First',
    });
    await db.insert(taskActivity).values({
      id: newId(), workspaceId, taskId, actorId: userId, kind: 'created', toValue: 'Ship v1',
    });

    await db.delete(task).where(sql`id = ${taskId}`);

    expect(await db.select().from(comment)).toHaveLength(0);
    expect(await db.select().from(taskActivity)).toHaveLength(0);
  });

  it('defaults edited_at to null and stamps created_at', async () => {
    const { userId, workspaceId, projectId, statusId } = await seedProject();
    const taskId = newId();
    await db.insert(task).values({
      id: taskId, workspaceId, projectId, title: 'Ship v1', statusId,
      position: positionBetween(null, null), createdBy: userId,
    });

    await db.insert(comment).values({
      id: newId(), workspaceId, taskId, authorId: userId, body: 'Looks good',
    });

    const [row] = await db.select().from(comment);
    expect(row.editedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});
