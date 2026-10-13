import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { organization } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { updateWorkspaceLogo } from '@/server/settings/service';
import { listMyWorkspaces } from '@/server/workspaces/queries';

beforeEach(resetDb);
afterAll(closeDb);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function setup(slug: string, role: WorkspaceContext['role'] = 'owner') {
  const user = await createUser(`${slug}@example.com`);
  const ws = await createWorkspace(user.id, 'Acme', slug);
  const ctx: WorkspaceContext = {
    userId: user.id, workspaceId: ws.id, slug, role, timezone: 'UTC', workspaceTimezone: 'UTC',
  };
  return { ctx, user };
}

async function logoOf(workspaceId: string) {
  const [row] = await db.select({ logo: organization.logo }).from(organization).where(eq(organization.id, workspaceId));
  return row.logo;
}

describe('updateWorkspaceLogo', () => {
  it('sets the logo as an admin and lists it with the workspace', async () => {
    const { ctx, user } = await setup('logo-set', 'admin');

    const result = await updateWorkspaceLogo(ctx, PNG);

    expect(result.ok).toBe(true);
    expect(await logoOf(ctx.workspaceId)).toBe(PNG);
    expect((await listMyWorkspaces(user.id))[0].logo).toBe(PNG);
  });

  it('null removes the logo', async () => {
    const { ctx } = await setup('logo-clear');
    await updateWorkspaceLogo(ctx, PNG);

    const result = await updateWorkspaceLogo(ctx, null);

    expect(result.ok).toBe(true);
    expect(await logoOf(ctx.workspaceId)).toBeNull();
  });

  it('refuses a plain member', async () => {
    const { ctx } = await setup('logo-member', 'member');

    expect((await updateWorkspaceLogo(ctx, PNG)).ok).toBe(false);
    expect(await logoOf(ctx.workspaceId)).toBeNull();
  });

  it.each([
    ['a remote URL', 'https://example.com/logo.png'],
    ['an SVG', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['an oversized image', `data:image/png;base64,${'A'.repeat(200_000)}`],
  ])('rejects %s and writes nothing', async (_label, logo) => {
    const { ctx } = await setup(`logo-bad-${logo.length}`);

    const result = await updateWorkspaceLogo(ctx, logo);

    expect(result).toEqual({ ok: false, error: 'That image is not valid.' });
    expect(await logoOf(ctx.workspaceId)).toBeNull();
  });
});
