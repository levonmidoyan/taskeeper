import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import type { WorkspaceContext } from '@/lib/session';
import { getWorkspaceVersion, pollWorkspaceVersion } from '@/server/changes/queries';
import { emitChange, emitChangeFor } from '@/server/changes/service';

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
