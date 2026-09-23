import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { ForbiddenError } from '@/lib/result';
import { requireRole, resolveWorkspace } from '@/lib/session';

beforeEach(resetDb);
afterAll(closeDb);

describe('resolveWorkspace', () => {
  it('returns context for a member', async () => {
    const ada = await createUser('ada@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme');

    const ctx = await resolveWorkspace(ada.id, 'acme');

    expect(ctx).not.toBeNull();
    expect(ctx!.workspaceId).toBe(acme.id);
    expect(ctx!.userId).toBe(ada.id);
    expect(ctx!.role).toBe('owner');
  });

  it('carries the workspace timezone, defaulting to Asia/Yerevan', async () => {
    const ada = await createUser('tz@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-tz');

    const ctx = await resolveWorkspace(ada.id, 'acme-tz');
    expect(ctx!.timezone).toBe('Asia/Yerevan');
  });

  it('returns null for a non-member, not a different error', async () => {
    // Null rather than a "forbidden" signal: callers render 404, so an outsider
    // cannot distinguish "not yours" from "does not exist" and probe for slugs.
    const ada = await createUser('ada2@example.com');
    const bob = await createUser('bob@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-private');

    expect(await resolveWorkspace(bob.id, 'acme-private')).toBeNull();
  });

  it('returns null for a member of a different workspace, not just a total stranger', async () => {
    // The realistic attack shape: bob is a legitimate member of his own
    // workspace and tries acme's slug, not an account with zero memberships.
    const ada = await createUser('ada-cross@example.com');
    const bob = await createUser('bob-cross@example.com');
    await createWorkspace(ada.id, 'Acme', 'acme-cross');
    await createWorkspace(bob.id, 'Bob Co', 'bobco-cross');

    expect(await resolveWorkspace(bob.id, 'acme-cross')).toBeNull();
  });

  it('rejects a duplicate membership row for the same user in the same workspace', async () => {
    // member_org_user_idx is a UNIQUE index precisely so resolveWorkspace's role
    // pick can never be non-deterministic between two rows for the same pair.
    const ada = await createUser('ada-dup@example.com');
    const bob = await createUser('bob-dup@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-dup');
    await joinWorkspace(bob.id, acme.id, 'member');

    await expect(joinWorkspace(bob.id, acme.id, 'admin')).rejects.toThrow();
  });

  it('returns null for a slug that does not exist', async () => {
    const ada = await createUser('ada3@example.com');
    expect(await resolveWorkspace(ada.id, 'no-such-workspace')).toBeNull();
  });

  it('returns null after a member is removed', async () => {
    const ada = await createUser('ada4@example.com');
    const bob = await createUser('bob2@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-removed');
    const membership = await joinWorkspace(bob.id, acme.id, 'member');

    expect(await resolveWorkspace(bob.id, 'acme-removed')).not.toBeNull();
    await membership.remove();
    expect(await resolveWorkspace(bob.id, 'acme-removed')).toBeNull();
  });

  it('gives each member their own role in the same workspace', async () => {
    const ada = await createUser('owner@example.com');
    const bob = await createUser('member@example.com');
    const acme = await createWorkspace(ada.id, 'Acme', 'acme-roles');
    await joinWorkspace(bob.id, acme.id, 'member');

    expect((await resolveWorkspace(ada.id, 'acme-roles'))!.role).toBe('owner');
    expect((await resolveWorkspace(bob.id, 'acme-roles'))!.role).toBe('member');
  });
});

describe('requireRole', () => {
  const ctx = {
    userId: 'u1', workspaceId: 'w1', slug: 'w', role: 'member' as const, timezone: 'Asia/Yerevan',
  };

  it('passes when the role matches', () => {
    expect(() => requireRole({ ...ctx, role: 'admin' }, 'owner', 'admin')).not.toThrow();
  });

  it('throws ForbiddenError when it does not', () => {
    expect(() => requireRole(ctx, 'owner', 'admin')).toThrow(ForbiddenError);
  });

  it('allows an owner everywhere an admin is allowed', () => {
    expect(() => requireRole({ ...ctx, role: 'owner' }, 'owner', 'admin')).not.toThrow();
  });
});
