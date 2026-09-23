import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace } from '../setup/factories';
import { listMyWorkspaces } from '@/server/workspaces/queries';
import { createWorkspaceForUser } from '@/server/workspaces/service';
import { slugify } from '@/lib/slug';
import { member, organization, workspaceSettings } from '@/db';
import { eq } from 'drizzle-orm';

beforeEach(resetDb);
afterAll(closeDb);

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify("Ada's  Team!!")).toBe('adas-team');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -- Hello --  ')).toBe('hello');
  });

  it('falls back to "workspace" when nothing survives', () => {
    expect(slugify('!!!')).toBe('workspace');
  });
});

describe('createWorkspaceForUser', () => {
  it('creates the workspace, its settings row, and an owner membership', async () => {
    const ada = await createUser('ada@example.com');

    const created = await createWorkspaceForUser(ada.id, 'Acme Corp');

    expect(created.slug).toBe('acme-corp');

    const [settings] = await db
      .select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, created.id));
    expect(settings.timezone).toBe('Asia/Yerevan');
    expect(settings.weekStart).toBe(1);

    const [membership] = await db
      .select().from(member).where(eq(member.organizationId, created.id));
    expect(membership.userId).toBe(ada.id);
    expect(membership.role).toBe('owner');
  });

  it('disambiguates a slug that is already taken', async () => {
    const ada = await createUser('ada2@example.com');
    const bob = await createUser('bob@example.com');
    await createWorkspaceForUser(ada.id, 'Acme');

    const second = await createWorkspaceForUser(bob.id, 'Acme');

    expect(second.slug).not.toBe('acme');
    expect(second.slug.startsWith('acme-')).toBe(true);
    // The disambiguation suffix must stay inside slugify's own alphabet: no
    // underscore, no leading/trailing/doubled hyphen, lowercase only. nanoid's
    // default alphabet includes '_' and '-', which would otherwise leak through.
    expect(second.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('never lands on a slug that collides with a reserved top-level route', async () => {
    const ada = await createUser('ada-reserved@example.com');

    const created = await createWorkspaceForUser(ada.id, 'New Workspace');

    expect(created.slug).not.toBe('new-workspace');

    // The stored slug must actually be the one usable to reach the workspace.
    const [row] = await db
      .select({ id: organization.id }).from(organization).where(eq(organization.slug, created.slug));
    expect(row.id).toBe(created.id);
  });

  it('disambiguates every reserved top-level segment that exists in src/app today', async () => {
    const ada = await createUser('ada-reserved2@example.com');

    const reserved = ['New Workspace', 'Sign In', 'Sign Up', 'Api'];
    for (const name of reserved) {
      const created = await createWorkspaceForUser(ada.id, name);
      expect(created.slug).not.toBe(slugify(name));
    }
  });
});

describe('listMyWorkspaces', () => {
  it('returns only workspaces the user belongs to', async () => {
    const ada = await createUser('ada3@example.com');
    const bob = await createUser('bob2@example.com');
    await createWorkspace(ada.id, 'Ada Co', 'ada-co');
    await createWorkspace(bob.id, 'Bob Co', 'bob-co');

    const mine = await listMyWorkspaces(ada.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].slug).toBe('ada-co');
    expect(mine[0].role).toBe('owner');
  });

  it('returns an empty array for a user with none', async () => {
    const carol = await createUser('carol@example.com');
    expect(await listMyWorkspaces(carol.id)).toEqual([]);
  });
});
