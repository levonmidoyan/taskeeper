import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, resetDb } from '../setup/db';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { savedView } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { archiveProject, createProject } from '@/server/projects/service';
import { getView, listViews } from '@/server/views/queries';
import { resolveView } from '@/server/views/resolve';
import { createView, deleteView, duplicateView, updateView } from '@/server/views/service';

beforeEach(resetDb);
afterAll(closeDb);

async function setup() {
  const ada = await createUser('ada-v@example.com', 'Ada');   // owner
  const bob = await createUser('bob-v@example.com', 'Bob');   // member
  const cy = await createUser('cy-v@example.com', 'Cy');      // admin
  const ws = await createWorkspace(ada.id, 'Acme', 'ws-v');
  await joinWorkspace(bob.id, ws.id, 'member');
  await joinWorkspace(cy.id, ws.id, 'admin');
  const base = { workspaceId: ws.id, slug: 'ws-v', timezone: 'UTC', workspaceTimezone: 'UTC' };
  const ctx: WorkspaceContext = { ...base, userId: ada.id, role: 'owner' };
  const bobCtx: WorkspaceContext = { ...base, userId: bob.id, role: 'member' };
  const cyCtx: WorkspaceContext = { ...base, userId: cy.id, role: 'admin' };
  const p = await createProject(ctx, { name: 'Web' });
  if (!p.ok) throw new Error();
  return { ctx, bobCtx, cyCtx, ws, projectId: p.data.id };
}

async function make(ctx: WorkspaceContext, input: Parameters<typeof createView>[1]) {
  const r = await createView(ctx, input);
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe('createView', () => {
  it('stores a cleaned filter, owner from ctx, private by default', async () => {
    const { bobCtx, projectId } = await setup();
    const id = await make(bobCtx, {
      projectId, name: '  Mine  ', layout: 'list',
      filter: { assignee: { op: 'is', ids: ['me', 'me'] }, junk: 1 }, sort: 'due.asc',
    });
    const view = await getView(bobCtx, id);
    expect(view).toMatchObject({
      name: 'Mine', shared: false, layout: 'list', mine: true, canEdit: true,
      filter: { assignee: { op: 'is', ids: ['me'] } }, sort: 'due.asc', filterReset: false,
    });
  });

  it('validates name, filter, layout and project', async () => {
    const { ctx, projectId } = await setup();
    expect(await createView(ctx, { projectId, name: ' ', layout: 'list', filter: {} })).toMatchObject({ ok: false });
    expect(await createView(ctx, { projectId, name: 'x'.repeat(61), layout: 'list', filter: {} })).toMatchObject({ ok: false });
    expect(await createView(ctx, { projectId, name: 'Bad', layout: 'list', filter: { priority: { op: 'is', values: ['nope'] } } }))
      .toEqual({ ok: false, error: 'That filter is not valid.' });
    expect(await createView(ctx, { projectId: null, name: 'Board', layout: 'board', filter: {} }))
      .toEqual({ ok: false, error: 'A board view needs a project.' });
    expect(await createView(ctx, { projectId: 'nope', name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
    await archiveProject(ctx, { projectId });
    expect(await createView(ctx, { projectId, name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
  });

  it('keeps sort for list views only, and drops a malformed sort', async () => {
    const { ctx, projectId } = await setup();
    const board = await make(ctx, { projectId, name: 'B', layout: 'board', filter: {}, sort: 'due.asc' });
    const list = await make(ctx, { projectId, name: 'L', layout: 'list', filter: {}, sort: 'nope.up' });
    expect((await getView(ctx, board))!.sort).toBeNull();
    expect((await getView(ctx, list))!.sort).toBeNull();
  });

  it('rejects a project from another workspace', async () => {
    const { ctx } = await setup();
    const eve = await createUser('eve-v@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-v2');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-v2', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    const p2 = await createProject(eveCtx, { name: 'Secret' });
    if (!p2.ok) throw new Error();
    expect(await createView(ctx, { projectId: p2.data.id, name: 'X', layout: 'list', filter: {} }))
      .toEqual({ ok: false, error: 'Project not found.' });
  });
});

describe('visibility and permissions', () => {
  it('lists own + shared in scope; private views are invisible to others, admins included', async () => {
    const { ctx, bobCtx, cyCtx, projectId } = await setup();
    await make(bobCtx, { projectId, name: 'Bob private', layout: 'list', filter: {} });
    await make(bobCtx, { projectId, name: 'Bob shared', layout: 'list', filter: {}, shared: true });
    await make(ctx, { projectId: null, name: 'Ada workspace', layout: 'list', filter: {}, shared: true });

    expect((await listViews(bobCtx, { projectId })).map((v) => v.name)).toEqual(['Bob private', 'Bob shared']);
    expect((await listViews(cyCtx, { projectId })).map((v) => v.name)).toEqual(['Bob shared']);
    expect((await listViews(bobCtx, { workspace: true })).map((v) => v.name)).toEqual(['Ada workspace']);
  });

  it('permission matrix for update/delete', async () => {
    const { ctx, bobCtx, cyCtx, projectId } = await setup();
    const priv = await make(bobCtx, { projectId, name: 'P', layout: 'list', filter: {} });
    const shared = await make(bobCtx, { projectId, name: 'S', layout: 'list', filter: {}, shared: true });
    const adaShared = await make(ctx, { projectId, name: 'A', layout: 'list', filter: {}, shared: true });

    // Private: only the owner; others get "not found", not "forbidden".
    expect(await updateView(cyCtx, { id: priv, name: 'x' })).toEqual({ ok: false, error: 'View not found.' });
    expect(await deleteView(ctx, { id: priv })).toEqual({ ok: false, error: 'View not found.' });
    expect(await updateView(bobCtx, { id: priv, name: 'P2' })).toEqual({ ok: true, data: null });

    // Shared: owner, workspace admin and owner may change; another member may not.
    expect(await updateView(cyCtx, { id: shared, name: 'S2' })).toEqual({ ok: true, data: null });
    expect(await updateView(ctx, { id: shared, shared: false })).toEqual({ ok: true, data: null });
    expect(await updateView(bobCtx, { id: adaShared, name: 'x' }))
      .toEqual({ ok: false, error: 'Only the owner or a workspace admin can change this view.' });
    expect((await getView(bobCtx, adaShared))!.canEdit).toBe(false);
    expect((await getView(cyCtx, adaShared))!.canEdit).toBe(true);
    expect(await deleteView(bobCtx, { id: adaShared })).toMatchObject({ ok: false });
    expect(await deleteView(cyCtx, { id: adaShared })).toEqual({ ok: true, data: null });
    expect(await getView(ctx, adaShared)).toBeNull();
  });

  it('getView hides other workspaces’ views', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'Shared', layout: 'list', filter: {}, shared: true });
    const eve = await createUser('eve-v2@example.com', 'Eve');
    const ws2 = await createWorkspace(eve.id, 'Other', 'ws-v3');
    const eveCtx: WorkspaceContext = { userId: eve.id, workspaceId: ws2.id, slug: 'ws-v3', role: 'owner', timezone: 'UTC', workspaceTimezone: 'UTC' };
    expect(await getView(eveCtx, id)).toBeNull();
    expect(await deleteView(eveCtx, { id })).toEqual({ ok: false, error: 'View not found.' });
  });

  it('archived project hides its views', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    await archiveProject(ctx, { projectId });
    expect(await listViews(ctx, { projectId })).toEqual([]);
    expect(await getView(ctx, id)).toBeNull();
  });
});

describe('updateView / duplicateView', () => {
  it('update re-validates the filter and keeps layout', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    expect(await updateView(ctx, { id, filter: { q: 'nope', priority: { op: 'is', values: ['x'] } } }))
      .toEqual({ ok: false, error: 'That filter is not valid.' });
    expect(await updateView(ctx, { id, filter: { q: 'deploy' }, sort: 'title.desc' })).toEqual({ ok: true, data: null });
    expect(await getView(ctx, id)).toMatchObject({ filter: { q: 'deploy' }, sort: 'title.desc', layout: 'list' });
  });

  it('duplicate copies a readable view as the caller’s private view', async () => {
    const { ctx, bobCtx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'Team', layout: 'board', filter: { q: 'x' }, shared: true });
    const copy = await duplicateView(bobCtx, { id });
    if (!copy.ok) throw new Error(copy.error);
    expect(await getView(bobCtx, copy.data.id)).toMatchObject({
      name: 'Team (copy)', shared: false, mine: true, layout: 'board', filter: { q: 'x' }, projectId,
    });
    const priv = await make(ctx, { projectId, name: 'Private', layout: 'list', filter: {} });
    expect(await duplicateView(bobCtx, { id: priv })).toEqual({ ok: false, error: 'View not found.' });
  });
});

describe('unreadable stored filter', () => {
  it('reads as {} with filterReset, and a save repairs it', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: {} });
    await db.update(savedView)
      .set({ filter: sql`'{"priority":{"op":"is","values":["nope"]}}'::jsonb` })
      .where(eq(savedView.id, id));
    expect(await getView(ctx, id)).toMatchObject({ filter: {}, filterReset: true });
    await updateView(ctx, { id, filter: {} });
    expect(await getView(ctx, id)).toMatchObject({ filter: {}, filterReset: false });
  });
});

describe('resolveView', () => {
  it('no view: the URL filter with the layout default state', async () => {
    const { ctx, projectId } = await setup();
    expect(await resolveView(ctx, { q: 'x' }, { layout: 'list', projectId })).toEqual({
      filter: { state: 'open', q: 'x' }, sort: null, view: null, modified: false, viewMissing: false,
    });
  });

  it('bare ?view= redirects to the view’s full link', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' });
    expect(await resolveView(ctx, { view: id }, { layout: 'list', projectId }))
      .toEqual({ redirect: `/ws-v/projects/${projectId}/list?view=${id}&state=open&q=x&sort=due.asc` });
  });

  it('opened from its link: not modified; edited: modified; every field cleared: modified, no redirect', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' });
    const at = { layout: 'list' as const, projectId };
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'x', sort: 'due.asc' }, at))
      .toMatchObject({ modified: false, filter: { state: 'open', q: 'x' } });
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'y', sort: 'due.asc' }, at))
      .toMatchObject({ modified: true });
    expect(await resolveView(ctx, { view: id, state: 'open', q: 'x' }, at))
      .toMatchObject({ modified: true }); // sort cleared
    expect(await resolveView(ctx, { view: id, state: 'open' }, at))
      .toMatchObject({ modified: true, filter: { state: 'open' } });
  });

  it('a view opened on the wrong page redirects to its own page', async () => {
    const { ctx, projectId } = await setup();
    const id = await make(ctx, { projectId, name: 'V', layout: 'board', filter: {} });
    expect(await resolveView(ctx, { view: id, state: 'all' }, { layout: 'list', projectId }))
      .toEqual({ redirect: `/ws-v/projects/${projectId}?view=${id}&state=all` });
  });

  it('missing or unreadable view: URL filter, viewMissing', async () => {
    const { ctx, projectId } = await setup();
    expect(await resolveView(ctx, { view: 'gone', q: 'x' }, { layout: 'list', projectId }))
      .toMatchObject({ view: null, viewMissing: true, filter: { state: 'open', q: 'x' } });
  });
});
