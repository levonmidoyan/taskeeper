import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { createProject } from '@/server/projects/service';
import { getProject } from '@/server/projects/queries';
import { createTask } from '@/server/tasks/service';
import { getTask } from '@/server/tasks/queries';
import { createLabel, setTaskLabels } from '@/server/labels/service';
import { listLabels } from '@/server/labels/queries';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const project = await createProject(ctx, { name: 'Website' });
  if (!project.ok) throw new Error('setup failed');
  const detail = await getProject(ctx, project.data.id);
  return { ctx, projectId: project.data.id, statuses: detail!.statuses };
}

describe('createLabel', () => {
  it('creates a workspace-scoped label', async () => {
    const { ctx } = await setup('ada@example.com', 'acme');

    const result = await createLabel(ctx, { name: 'bug' });

    expect(result.ok).toBe(true);
    const labels = await listLabels(ctx);
    expect(labels.map((l) => l.name)).toEqual(['bug']);
  });

  it('returns the existing label instead of failing on a duplicate name', async () => {
    const { ctx } = await setup('ada2@example.com', 'acme2');
    const first = await createLabel(ctx, { name: 'bug' });
    const second = await createLabel(ctx, { name: 'bug' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Typing an existing name in the picker must attach it, not error.
    expect(second.data.id).toBe(first.data.id);
    expect(await listLabels(ctx)).toHaveLength(1);
  });

  it('allows the same label name in two workspaces', async () => {
    const a = await setup('a@example.com', 'ws-a');
    const b = await setup('b@example.com', 'ws-b');

    expect((await createLabel(a.ctx, { name: 'bug' })).ok).toBe(true);
    expect((await createLabel(b.ctx, { name: 'bug' })).ok).toBe(true);
  });

  it('rejects an empty name', async () => {
    const { ctx } = await setup('ada3@example.com', 'acme3');
    expect((await createLabel(ctx, { name: '  ' })).ok).toBe(false);
  });
});

describe('setTaskLabels', () => {
  it('replaces the label set on a task', async () => {
    const { ctx, projectId } = await setup('ada4@example.com', 'acme4');
    const created = await createTask(ctx, { projectId, title: 'Task' });
    const bug = await createLabel(ctx, { name: 'bug' });
    const docs = await createLabel(ctx, { name: 'docs' });
    if (!created.ok || !bug.ok || !docs.ok) throw new Error('setup failed');

    await setTaskLabels(ctx, { taskId: created.data.id, labelIds: [bug.data.id, docs.data.id] });
    await setTaskLabels(ctx, { taskId: created.data.id, labelIds: [docs.data.id] });

    const after = await getTask(ctx, created.data.id);
    expect(after!.labels.map((l) => l.name)).toEqual(['docs']);
  });

  it('accepts the same label id twice, as re-attaching an attached label sends', async () => {
    const { ctx, projectId } = await setup('ada5@example.com', 'acme5');
    const created = await createTask(ctx, { projectId, title: 'Task' });
    const bug = await createLabel(ctx, { name: 'bug' });
    if (!created.ok || !bug.ok) throw new Error('setup failed');

    const result = await setTaskLabels(ctx, {
      taskId: created.data.id, labelIds: [bug.data.id, bug.data.id],
    });

    expect(result.ok).toBe(true);
    const after = await getTask(ctx, created.data.id);
    expect(after!.labels.map((l) => l.name)).toEqual(['bug']);
  });

  it('refuses a label from another workspace', async () => {
    const a = await setup('a2@example.com', 'ws-a2');
    const b = await setup('b2@example.com', 'ws-b2');
    const created = await createTask(a.ctx, { projectId: a.projectId, title: 'Task' });
    const foreign = await createLabel(b.ctx, { name: 'theirs' });
    if (!created.ok || !foreign.ok) throw new Error('setup failed');

    const result = await setTaskLabels(a.ctx, {
      taskId: created.data.id, labelIds: [foreign.data.id],
    });

    expect(result.ok).toBe(false);
    expect((await getTask(a.ctx, created.data.id))!.labels).toHaveLength(0);
  });

  it('refuses to label a task in another workspace', async () => {
    const a = await setup('a3@example.com', 'ws-a3');
    const b = await setup('b3@example.com', 'ws-b3');
    const theirs = await createTask(b.ctx, { projectId: b.projectId, title: 'Theirs' });
    const mine = await createLabel(a.ctx, { name: 'mine' });
    if (!theirs.ok || !mine.ok) throw new Error('setup failed');

    const result = await setTaskLabels(a.ctx, {
      taskId: theirs.data.id, labelIds: [mine.data.id],
    });
    expect(result.ok).toBe(false);
  });
});
