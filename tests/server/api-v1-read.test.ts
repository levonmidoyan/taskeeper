import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, resetDb } from '../setup/db';
import { apiFixture, apiUser, call } from '../setup/api';
import { createUser, createWorkspace, joinWorkspace } from '../setup/factories';
import { createLabel } from '@/server/labels/service';
import { archiveProject, createProject } from '@/server/projects/service';
import { createTask } from '@/server/tasks/service';
import * as me from '@/app/api/v1/me/route';
import * as workspaces from '@/app/api/v1/workspaces/route';
import * as projects from '@/app/api/v1/workspaces/[slug]/projects/route';
import * as oneProject from '@/app/api/v1/workspaces/[slug]/projects/[projectId]/route';
import * as labels from '@/app/api/v1/workspaces/[slug]/labels/route';
import * as members from '@/app/api/v1/workspaces/[slug]/members/route';

beforeEach(resetDb);
afterAll(closeDb);

describe('GET /me', () => {
  it('returns the token owner', async () => {
    const ada = await apiUser('v1@example.com', 'Ada');
    const res = await call(me.GET, { path: '/me', token: ada.token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: ada.id, name: 'Ada', email: 'v1@example.com' });
  });
});

describe('GET /workspaces', () => {
  it('lists only memberships, with role', async () => {
    const ada = await apiUser('v2@example.com');
    const bob = await createUser('v2b@example.com');
    await createWorkspace(ada.id, 'Acme', 'ws-v2');
    const theirs = await createWorkspace(bob.id, 'Bob Co', 'ws-v2b');
    await joinWorkspace(ada.id, theirs.id, 'member');
    await createWorkspace(bob.id, 'Private', 'ws-v2c');

    const res = await call(workspaces.GET, { path: '/workspaces', token: ada.token });

    expect(res.json).toEqual({ data: [
      { slug: 'ws-v2', name: 'Acme', role: 'owner' },
      { slug: 'ws-v2b', name: 'Bob Co', role: 'member' },
    ] });
  });
});

describe('projects', () => {
  it('lists active projects with open task counts', async () => {
    const { ada, ws, ctx, project } = await apiFixture('v3');
    await createTask(ctx, { projectId: project.id, title: 'Open' });
    const old = await createProject(ctx, { name: 'Old' });
    if (!old.ok) throw new Error();
    await archiveProject(ctx, { projectId: old.data.id });

    const res = await call(projects.GET, { path: `/workspaces/${ws.slug}/projects`, token: ada.token, params: { slug: ws.slug } });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: [{ id: project.id, name: 'Web', slug: project.slug, color: project.color, openTaskCount: 1 }] });
  });

  it('returns one project with its statuses in board order; archived and foreign ones 404', async () => {
    const { ada, ws, ctx, project, statuses } = await apiFixture('v4');
    const get = (projectId: string) =>
      call(oneProject.GET, { path: `/workspaces/${ws.slug}/projects/${projectId}`, token: ada.token, params: { slug: ws.slug, projectId } });

    const res = await get(project.id);
    expect(res.json).toEqual({
      id: project.id, name: 'Web', slug: project.slug, color: project.color, openTaskCount: 0,
      statuses: statuses.map((s) => ({ id: s.id, name: s.name, isDone: s.isDone })),
    });

    await archiveProject(ctx, { projectId: project.id });
    expect((await get(project.id)).status).toBe(404);

    const other = await apiFixture('v4b');
    expect((await get(other.project.id)).status).toBe(404);
  });
});

describe('labels and members', () => {
  it('lists labels and members with emails', async () => {
    const { ada, ws, ctx } = await apiFixture('v5');
    const bob = await createUser('v5b@example.com', 'Bob');
    await joinWorkspace(bob.id, ws.id, 'member');
    const bug = await createLabel(ctx, { name: 'Bug' });
    if (!bug.ok) throw new Error();

    const l = await call(labels.GET, { path: `/workspaces/${ws.slug}/labels`, token: ada.token, params: { slug: ws.slug } });
    const m = await call(members.GET, { path: `/workspaces/${ws.slug}/members`, token: ada.token, params: { slug: ws.slug } });

    expect(l.json).toEqual({ data: [{ id: bug.data.id, name: 'Bug', color: bug.data.color }] });
    expect(m.json).toEqual({ data: [
      { id: ada.id, name: 'Ada', email: 'v5@example.com', role: 'owner' },
      { id: bob.id, name: 'Bob', email: 'v5b@example.com', role: 'member' },
    ] });
  });

  it('a removed member gets 404 at once', async () => {
    const { ws } = await apiFixture('v6');
    const bob = await apiUser('v6b@example.com', 'Bob');
    const membership = await joinWorkspace(bob.id, ws.id, 'member');
    const get = () => call(labels.GET, { path: `/workspaces/${ws.slug}/labels`, token: bob.token, params: { slug: ws.slug } });

    expect((await get()).status).toBe(200);
    await membership.remove();
    expect((await get()).status).toBe(404);
  });
});
