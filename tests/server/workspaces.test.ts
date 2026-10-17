import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { ForbiddenError } from '@/lib/result';
import { listMyWorkspaces } from '@/server/workspaces/queries';
import { createWorkspaceForUser, deleteWorkspace, RESERVED_SLUGS } from '@/server/workspaces/service';
import { slugify } from '@/lib/slug';
import { member, organization, project, task, workspaceSettings } from '@/db';
import { eq } from 'drizzle-orm';
import type { WorkspaceContext } from '@/lib/session';
import { createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';

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

    const reserved = ['New Workspace', 'Sign In', 'Sign Up', 'Api', 'Invite', 'Docs'];
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

describe('RESERVED_SLUGS', () => {
  it('covers every top-level route segment under src/app', () => {
    const app = join(__dirname, '../../src/app');
    // Route groups like (app) add no segment; look inside them instead.
    const segments = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('[') && e.name !== 'fonts')
        .flatMap((e) => (e.name.startsWith('(') ? segments(join(dir, e.name)) : [e.name]));
    for (const segment of segments(app)) expect(RESERVED_SLUGS).toContain(segment);
  });
});

describe('deleteWorkspace', () => {
  function ctxFor(userId: string, workspaceId: string, slug: string, role: WorkspaceContext['role'] = 'owner'): WorkspaceContext {
    return { userId, workspaceId, slug, role, timezone: 'Asia/Yerevan', workspaceTimezone: 'Asia/Yerevan' };
  }

  it('deletes the workspace with its content and every membership', async () => {
    const owner = await createUser('wd1@example.com');
    const other = await createUser('wd2@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-wd1');
    await joinWorkspace(other.id, ws.id, 'member');
    const ctx = ctxFor(owner.id, ws.id, 'ws-wd1');
    const created = await createProject(ctx, { name: 'Website' });
    if (!created.ok) throw new Error('setup failed');
    await createTask(ctx, { projectId: created.data.id, title: 'Ship v1' });

    expect(await deleteWorkspace(ctx, { confirmName: 'Acme' })).toEqual({ ok: true, data: null });

    expect(await db.select().from(organization).where(eq(organization.id, ws.id))).toHaveLength(0);
    expect(await db.select().from(project).where(eq(project.workspaceId, ws.id))).toHaveLength(0);
    expect(await db.select().from(task).where(eq(task.workspaceId, ws.id))).toHaveLength(0);
    expect(await db.select().from(member).where(eq(member.organizationId, ws.id))).toHaveLength(0);
  });

  it('leaves the owner\'s other workspaces alone', async () => {
    const owner = await createUser('wd3@example.com');
    const doomed = await createWorkspace(owner.id, 'Doomed', 'ws-wd3a');
    const kept = await createWorkspace(owner.id, 'Kept', 'ws-wd3b');

    await deleteWorkspace(ctxFor(owner.id, doomed.id, 'ws-wd3a'), { confirmName: 'Doomed' });

    expect((await listMyWorkspaces(owner.id)).map((w) => w.id)).toEqual([kept.id]);
  });

  it('refuses when the typed name does not match', async () => {
    const owner = await createUser('wd4@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-wd4');

    const result = await deleteWorkspace(ctxFor(owner.id, ws.id, 'ws-wd4'), { confirmName: 'acme' });

    expect(result.ok).toBe(false);
    expect(await db.select().from(organization).where(eq(organization.id, ws.id))).toHaveLength(1);
  });

  it('accepts the name with surrounding spaces', async () => {
    const owner = await createUser('wd5@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-wd5');

    const result = await deleteWorkspace(ctxFor(owner.id, ws.id, 'ws-wd5'), { confirmName: '  Acme ' });

    expect(result.ok).toBe(true);
  });

  it('is for owners only', async () => {
    const owner = await createUser('wd6@example.com');
    const admin = await createUser('wd7@example.com');
    const ws = await createWorkspace(owner.id, 'Acme', 'ws-wd6');
    await joinWorkspace(admin.id, ws.id, 'admin');

    await expect(
      deleteWorkspace(ctxFor(admin.id, ws.id, 'ws-wd6', 'admin'), { confirmName: 'Acme' }),
    ).rejects.toThrow(ForbiddenError);
    expect(await db.select().from(organization).where(eq(organization.id, ws.id))).toHaveLength(1);
  });
});
