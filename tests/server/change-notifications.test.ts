import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { notification } from '@/db';
import { newId } from '@/lib/ids';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

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
