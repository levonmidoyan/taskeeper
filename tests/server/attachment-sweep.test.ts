import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import { attachment } from '@/db';
import { headObject, presignPut } from '@/lib/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { confirmUpload, requestUpload } from '@/server/attachments/service';
import { sweepAttachments } from '@/server/attachments/sweep';

beforeEach(async () => {
  await resetDb();
  await resetBucket();
});
afterAll(closeDb);

const body = new TextEncoder().encode('x');

async function setup() {
  const ada = await createUser('sw@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-sw');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-sw', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T' });
  if (!made.ok) throw new Error();
  return { ctx, taskId: made.data.id };
}

async function pending(ctx: WorkspaceContext, taskId: string) {
  const req = await requestUpload(ctx, { taskId, fileName: 'p.txt', contentType: 'text/plain', size: body.length });
  if (!req.ok) throw new Error();
  await uploadTo(req.data.url, body, 'text/plain');
  return req.data.id;
}

describe('sweepAttachments', () => {
  it('removes stale pending rows with their objects and objects with no row', async () => {
    const { ctx, taskId } = await setup();
    const stale = await pending(ctx, taskId);
    await db.update(attachment).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(attachment.id, stale));
    const fresh = await pending(ctx, taskId);
    const ready = await pending(ctx, taskId);
    await confirmUpload(ctx, { attachmentId: ready });
    const orphanKey = `ws/${ctx.workspaceId}/tasks/${taskId}/orphan`;
    await uploadTo(await presignPut({ key: orphanKey, contentType: 'text/plain', size: 1 }), body, 'text/plain');

    const result = await sweepAttachments({ dryRun: false });

    expect(result).toEqual({ staleRows: 1, orphanObjects: 2 });
    const ids = (await db.select({ id: attachment.id }).from(attachment)).map((r) => r.id).sort();
    expect(ids).toEqual([fresh, ready].sort());
    expect(await headObject(orphanKey)).toBeNull();
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${stale}`)).toBeNull();
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${fresh}`)).not.toBeNull();
  });

  it('deletes nothing on a dry run', async () => {
    const { ctx, taskId } = await setup();
    const stale = await pending(ctx, taskId);
    await db.update(attachment).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(attachment.id, stale));

    const result = await sweepAttachments({ dryRun: true });

    expect(result).toEqual({ staleRows: 1, orphanObjects: 1 });
    expect(await db.select().from(attachment)).toHaveLength(1);
    expect(await headObject(`ws/${ctx.workspaceId}/tasks/${taskId}/${stale}`)).not.toBeNull();
  });
});
