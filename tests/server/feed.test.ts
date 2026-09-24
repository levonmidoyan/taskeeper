import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { formatInZone } from '@/lib/dates';
import { createProject } from '@/server/projects/service';
import { createTask, updateTask } from '@/server/tasks/service';
import { createComment } from '@/server/comments/service';
import { listTaskFeed } from '@/server/activity/queries';
import type { WorkspaceContext } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

async function setup(email: string, slug: string) {
  const user = await createUser(email, 'Ada');
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role: 'owner', timezone: 'Asia/Yerevan',
  };
  const created = await createProject(ctx, { name: 'Website' });
  if (!created.ok) throw new Error('setup failed');
  const madeTask = await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });
  if (!madeTask.ok) throw new Error('setup failed');
  return { ctx, taskId: madeTask.data.id };
}

describe('listTaskFeed', () => {
  it('interleaves comments and activity oldest first, with author names', async () => {
    const { ctx, taskId } = await setup('f1@example.com', 'ws-f1');
    await createComment(ctx, { taskId, body: 'Starting this' });
    await new Promise((r) => setTimeout(r, 2));
    await updateTask(ctx, { taskId, priority: 'high' });
    await new Promise((r) => setTimeout(r, 2));
    await createComment(ctx, { taskId, body: 'Nearly done' });

    const feed = await listTaskFeed(ctx, taskId);

    expect(feed.map((e) => e.type)).toEqual(['activity', 'comment', 'activity', 'comment']);
    expect(feed[0]).toMatchObject({ type: 'activity', kind: 'created', actorName: 'Ada' });
    expect(feed[1]).toMatchObject({ type: 'comment', body: 'Starting this', authorName: 'Ada' });
    expect(feed[2]).toMatchObject({ type: 'activity', kind: 'priority', from: 'none', to: 'high' });
    expect(feed[3]).toMatchObject({ type: 'comment', body: 'Nearly done' });
  });

  it('returns an empty feed for a task in another workspace', async () => {
    const a = await setup('f2a@example.com', 'ws-f2a');
    const b = await setup('f2b@example.com', 'ws-f2b');
    await createComment(a.ctx, { taskId: a.taskId, body: 'Private' });

    expect(await listTaskFeed(b.ctx, a.taskId)).toEqual([]);
  });

  // Review Focus 6 (spec §3.4): the clock is pinned to UTC by vitest.config.ts.
  it('carries an instant that renders as the next day in the workspace zone', async () => {
    const { ctx, taskId } = await setup('f3@example.com', 'ws-f3');
    const created = await createComment(ctx, { taskId, body: 'Late one' });
    if (!created.ok) throw new Error('setup failed');

    const feed = await listTaskFeed(ctx, taskId);
    const entry = feed.find((e) => e.type === 'comment')!;
    expect(entry.createdAt).toBeInstanceOf(Date);

    // 21:00 UTC on the 23rd is 01:00 on the 24th in Yerevan. The feed hands the
    // renderer an instant, so the zone is applied once, at render time.
    const at21Utc = new Date('2026-09-23T21:00:00Z');
    expect(formatInZone(at21Utc, ctx.timezone)).toBe('24 Sep 2026, 01:00');
  });
});
