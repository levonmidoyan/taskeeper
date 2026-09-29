import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { resetBucket, uploadTo } from '../setup/storage';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import { confirmUpload, requestUpload } from '@/server/attachments/service';
import { resolveDownload } from '@/server/attachments/download';

beforeEach(async () => {
  await resetDb();
  await resetBucket();
});
afterAll(closeDb);

async function setup() {
  const ada = await createUser('dl@example.com', 'Ada');
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-dl');
  const ctx: WorkspaceContext = { userId: ada.id, workspaceId: ws.id, slug: 'ws-dl', role: 'owner', timezone: 'UTC' };
  const project = await createProject(ctx, { name: 'P' });
  if (!project.ok) throw new Error();
  const made = await createTask(ctx, { projectId: project.data.id, title: 'T' });
  if (!made.ok) throw new Error();
  return { ctx, ws, taskId: made.data.id };
}

async function upload(ctx: WorkspaceContext, taskId: string, fileName: string, contentType: string, confirm = true) {
  const body = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const req = await requestUpload(ctx, { taskId, fileName, contentType, size: body.length });
  if (!req.ok) throw new Error(req.error);
  await uploadTo(req.data.url, body, req.data.contentType);
  if (confirm) await confirmUpload(ctx, { attachmentId: req.data.id });
  return req.data.id;
}

describe('resolveDownload', () => {
  it('serves a png inline to a member', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'shot.png', 'image/png');

    const url = await resolveDownload(ctx.userId, id, { download: false });
    const res = await fetch(url!);

    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename="shot.png"/);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('forces attachment with ?download', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'shot.png', 'image/png');

    const res = await fetch((await resolveDownload(ctx.userId, id, { download: true }))!);

    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  // Review Focus 3.
  it('download of an svg is forced to attachment', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'logo.svg', 'image/svg+xml');

    const res = await fetch((await resolveDownload(ctx.userId, id, { download: false }))!);

    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('returns null for a pending upload', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png', false);
    expect(await resolveDownload(ctx.userId, id, { download: false })).toBeNull();
  });

  it('returns null for a member of another workspace', async () => {
    const { ctx, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png');
    const bob = await createUser('bob-dl@example.com');
    await createWorkspace(bob.id, 'Bob Co', 'bob-dl');

    expect(await resolveDownload(bob.id, id, { download: false })).toBeNull();
  });

  // Review Focus 4.
  it('404 once the user leaves the workspace', async () => {
    const { ctx, ws, taskId } = await setup();
    const id = await upload(ctx, taskId, 'a.png', 'image/png');
    const grace = await createUser('grace-dl@example.com');
    const membership = await joinWorkspace(grace.id, ws.id, 'member');
    expect(await resolveDownload(grace.id, id, { download: false })).not.toBeNull();

    await membership.remove();

    expect(await resolveDownload(grace.id, id, { download: false })).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const { ctx } = await setup();
    expect(await resolveDownload(ctx.userId, 'nope', { download: false })).toBeNull();
  });
});
