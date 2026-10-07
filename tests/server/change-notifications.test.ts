import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification, task, taskStatus, userSettings } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { commentExcerpt, notifyProjectChange, notifyTaskChange } from '@/server/notifications/changes';
import { createProject } from '@/server/projects/service';
import { createComment } from '@/server/comments/service';
import { createLabel, setTaskLabels } from '@/server/labels/service';
import { bulkUpdateTasks, createTask, moveTask, updateTask, updateTaskAndLabels } from '@/server/tasks/service';

beforeEach(resetDb);
afterAll(closeDb);

const ctxFor = (userId: string, ws: { id: string; slug: string }, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext => ({
  userId, workspaceId: ws.id, slug: ws.slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
});

/** Ada owns the workspace and created "Ship" in "Website"; Bob is a member. */
async function setup() {
  const adaUser = await createUser('cn-ada@example.com', 'Ada');
  const bobUser = await createUser('cn-bob@example.com', 'Bob');
  const ws = await createWorkspace(adaUser.id, 'Acme', 'ws-cn');
  await joinWorkspace(bobUser.id, ws.id, 'member');
  const ada = ctxFor(adaUser.id, ws);
  const bob = ctxFor(bobUser.id, ws, 'member');
  const project = await createProject(ada, { name: 'Website' });
  if (!project.ok) throw new Error('setup');
  const made = await createTask(ada, { projectId: project.data.id, title: 'Ship' });
  if (!made.ok) throw new Error('setup');
  return { ws, ada, bob, projectId: project.data.id, taskId: made.data.id };
}

const changeRow = (o: { userId: string; workspaceId: string; taskId: string; actorId: string }) => ({
  id: newId(), kind: 'task_change' as const, dedupeKey: `chg:${newId()}`,
  data: { title: 'Ship', projectName: 'Website', actorName: 'Bob', changes: ['title' as const] },
  ...o,
});

describe('schema', () => {
  it('allows one unread change row per recipient, task and actor', async () => {
    const { ada, bob, taskId } = await setup();
    const key = { userId: ada.userId, workspaceId: ada.workspaceId, taskId, actorId: bob.userId };
    await db.insert(notification).values(changeRow(key));
    await expect(db.insert(notification).values(changeRow(key))).rejects.toThrow();
  });

  it('allows a new unread row once the old one is read', async () => {
    const { ada, bob, taskId } = await setup();
    const key = { userId: ada.userId, workspaceId: ada.workspaceId, taskId, actorId: bob.userId };
    await db.insert(notification).values({ ...changeRow(key), readAt: new Date() });
    await db.insert(notification).values(changeRow(key));
    expect(await db.select().from(notification)).toHaveLength(2);
  });
});

const rows = () => db.select().from(notification).orderBy(notification.createdAt);

describe('notifyTaskChange', () => {
  it('notifies the creator, not the actor', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title', 'priority'] }));
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: ada.userId, actorId: bob.userId, kind: 'task_change', taskId, readAt: null });
    expect(row.dedupeKey).toMatch(/^chg:/);
    expect(row.data).toEqual({ title: 'Ship', projectName: 'Website', actorName: 'Bob', changes: ['title', 'priority'] });
  });

  it('does nothing when the actor is the only one involved', async () => {
    const { ada, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(ada, tx, { taskId, changes: ['title'] }));
    expect(await rows()).toHaveLength(0);
  });

  it('merges a second change into the unread row, in first-seen order', async () => {
    const { ada, bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title', 'priority'] }));
    const [first] = await rows();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority', 'status'], status: 'Done' }));
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(all[0].data).toMatchObject({ changes: ['title', 'priority', 'status'], status: 'Done' });
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
    expect(all[0].userId).toBe(ada.userId);
  });

  it('keeps an earlier comment excerpt and assignment through a later merge', async () => {
    const { ada, bob, taskId } = await setup();
    await db.update(task).set({ assigneeId: ada.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['assignee'] }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['comment'], comment: 'Looks good' }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    const [row] = await rows();
    expect(row.data).toMatchObject({ assignedToYou: true, comment: 'Looks good', changes: ['assignee', 'comment', 'title'] });
  });

  it('starts a new row once the old one is read', async () => {
    const { bob, taskId } = await setup();
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    await db.update(notification).set({ readAt: new Date() });
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority'] }));
    expect(await rows()).toHaveLength(2);
  });

  it('keeps separate rows per actor', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await db.update(task).set({ assigneeId: bob.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(ctxFor(cy.id, ws, 'member'), tx, { taskId, changes: ['title'] }));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    const all = await rows();
    // Ada from Cy, Bob from Cy, Ada from Bob.
    expect(all.map((r) => [r.userId, r.actorId]).sort()).toEqual(
      [[ada.userId, cy.id], [bob.userId, cy.id], [ada.userId, bob.userId]].sort(),
    );
  });

  it('tells the new assignee they were assigned and the previous one what changed', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy2@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    // Bob reassigns from Cy to Ada (who also created the task).
    await db.update(task).set({ assigneeId: ada.userId }).where(eq(task.id, taskId));
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['assignee'], previousAssigneeId: cy.id }));
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r.data]));
    expect(byUser[ada.userId]).toMatchObject({ assignedToYou: true });
    expect(byUser[cy.id]).toMatchObject({ changes: ['assignee'] });
    expect(byUser[cy.id]).not.toHaveProperty('assignedToYou');
  });

  it('skips recipients who turned it off or left the workspace', async () => {
    const { ada, bob, taskId } = await setup();
    const gone = await createUser('cn-gone@example.com', 'Gone');
    await db.update(task).set({ assigneeId: gone.id }).where(eq(task.id, taskId));
    await db.insert(userSettings).values({ userId: ada.userId, changeNotify: false });
    await db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] }));
    expect(await rows()).toHaveLength(0);
  });

  it('merges concurrent changes by one actor instead of failing', async () => {
    const { bob, taskId } = await setup();
    await Promise.all([
      db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['title'] })),
      db.transaction((tx) => notifyTaskChange(bob, tx, { taskId, changes: ['priority'] })),
    ]);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect([...(all[0].data as { changes: string[] }).changes].sort()).toEqual(['priority', 'title']);
  });

  it('leaves nothing behind when the transaction rolls back', async () => {
    const { bob, taskId } = await setup();
    await expect(db.transaction(async (tx) => {
      await notifyTaskChange(bob, tx, { taskId, changes: ['title'] });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
  });
});

describe('notifyProjectChange', () => {
  it('notifies every other member and merges archive then unarchive', async () => {
    const { ws, ada, bob, projectId } = await setup();
    const cy = await createUser('cn-cy3@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'archived', projectName: 'Website' }));
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'unarchived', projectName: 'Website' }));
    const all = await rows();
    expect(all.map((r) => r.userId).sort()).toEqual([bob.userId, cy.id].sort());
    for (const r of all) {
      expect(r).toMatchObject({ kind: 'project_change', projectId, actorId: ada.userId, taskId: null });
      expect(r.data).toEqual({ projectName: 'Website', actorName: 'Ada', changes: ['archived', 'unarchived'] });
    }
  });

  it('keeps the original name and the latest new name across renames', async () => {
    const { ada, projectId } = await setup();
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'renamed', projectName: 'Website', newName: 'Site' }));
    await db.transaction((tx) => notifyProjectChange(ada, tx, { projectId, change: 'renamed', projectName: 'Site', newName: 'Site v2' }));
    const [row] = await rows();
    expect(row.data).toEqual({ projectName: 'Website', newName: 'Site v2', actorName: 'Ada', changes: ['renamed'] });
  });
});

describe('commentExcerpt', () => {
  it('flattens whitespace and caps at 120 characters', () => {
    expect(commentExcerpt('  a\n\nb  ')).toBe('a b');
    const long = commentExcerpt('x'.repeat(200));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });
});

async function statuses(projectId: string) {
  return db.select().from(taskStatus).where(eq(taskStatus.projectId, projectId)).orderBy(taskStatus.position);
}

describe('task call sites', () => {
  it('updateTask notifies with every changed field, description included', async () => {
    const { ada, bob, taskId } = await setup();
    expect((await updateTask(bob, { taskId, title: 'Ship it', description: 'Now', priority: 'high' })).ok).toBe(true);
    const [row] = await rows();
    expect(row.userId).toBe(ada.userId);
    expect(row.data).toMatchObject({ title: 'Ship it', changes: ['title', 'priority', 'description'] });
  });

  it('an update that changes nothing notifies no one', async () => {
    const { bob, taskId } = await setup();
    await updateTask(bob, { taskId, title: 'Ship' });
    expect(await rows()).toHaveLength(0);
  });

  it('reassignment tells the new assignee and the previous one', async () => {
    const { ws, ada, bob, taskId } = await setup();
    const cy = await createUser('cn-cy4@example.com', 'Cy');
    await joinWorkspace(cy.id, ws.id, 'member');
    await updateTask(ada, { taskId, assigneeId: cy.id });
    expect(await rows()).toMatchObject([{ userId: cy.id, data: { assignedToYou: true } }]);
    await db.delete(notification);
    await updateTask(ada, { taskId, assigneeId: bob.userId });
    const byUser = Object.fromEntries((await rows()).map((r) => [r.userId, r.data]));
    expect(byUser[bob.userId]).toMatchObject({ assignedToYou: true });
    expect(byUser[cy.id]).toMatchObject({ changes: ['assignee'] });
  });

  it('labels via updateTaskAndLabels merge into the same row; an unknown label rolls everything back', async () => {
    const { ada, bob, taskId } = await setup();
    const bug = await createLabel(ada, { name: 'Bug' });
    if (!bug.ok) throw new Error('setup');
    await updateTaskAndLabels(bob, { taskId, title: 'Ship 2' }, [bug.data.id]);
    expect((await rows())[0].data).toMatchObject({ changes: ['title', 'labels'] });

    await db.delete(notification);
    const failed = await updateTaskAndLabels(bob, { taskId, title: 'Ship 3' }, ['nope']);
    expect(failed.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it('setTaskLabels notifies only when the set changes', async () => {
    const { ada, bob, taskId } = await setup();
    const bug = await createLabel(ada, { name: 'Bug' });
    if (!bug.ok) throw new Error('setup');
    await setTaskLabels(bob, { taskId, labelIds: [bug.data.id] });
    expect(await rows()).toHaveLength(1);
    await db.delete(notification);
    await setTaskLabels(bob, { taskId, labelIds: [bug.data.id] });
    expect(await rows()).toHaveLength(0);
  });

  it('a board move across columns notifies with the new status; a reorder does not', async () => {
    const { bob, taskId, projectId } = await setup();
    const [todo, , done] = await statuses(projectId);
    await moveTask(bob, { taskId, statusId: todo.id, beforeId: null, afterId: null });
    expect(await rows()).toHaveLength(0);
    await moveTask(bob, { taskId, statusId: done.id, beforeId: null, afterId: null });
    expect((await rows())[0].data).toMatchObject({ changes: ['status'], status: 'Done' });
  });

  it('bulk updates notify per task', async () => {
    const { ada, bob, taskId, projectId } = await setup();
    const second = await createTask(ada, { projectId, title: 'Docs' });
    if (!second.ok) throw new Error('setup');
    await bulkUpdateTasks(bob, { taskIds: [taskId, second.data.id], patch: { priority: 'high' } });
    expect((await rows()).map((r) => r.taskId).sort()).toEqual([taskId, second.data.id].sort());
  });

  it('creating a task assigned to someone else tells them', async () => {
    const { ada, bob, projectId } = await setup();
    const made = await createTask(ada, { projectId, title: 'For Bob', assigneeId: bob.userId });
    if (!made.ok) throw new Error('setup');
    expect(await rows()).toMatchObject([{ userId: bob.userId, taskId: made.data.id, data: { assignedToYou: true, changes: ['assignee'] } }]);
  });

  it('a comment notifies with an excerpt', async () => {
    const { ada, bob, taskId } = await setup();
    await createComment(bob, { taskId, body: 'Looks\n\ngood' });
    expect(await rows()).toMatchObject([{ userId: ada.userId, data: { changes: ['comment'], comment: 'Looks good' } }]);
  });
});
