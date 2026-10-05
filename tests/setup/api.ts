import { getProject } from '@/server/projects/queries';
import { createProject } from '@/server/projects/service';
import { resolveWorkspace } from '@/lib/session';
import type { RouteHandler } from '@/server/api/route';
import { createApiToken } from '@/server/api-tokens/service';
import { createUser, createWorkspace } from './factories';

/** A user with one never-expiring API token. */
export async function apiUser(email: string, name = 'Ada') {
  const user = await createUser(email, name);
  const created = await createApiToken({ userId: user.id }, { name: 'test', expiresInDays: null });
  if (!created.ok) throw new Error(created.error);
  return { ...user, token: created.data.token, tokenId: created.data.id };
}

/** A token-holding owner, their workspace and one project with the default columns. */
export async function apiFixture(tag: string) {
  const ada = await apiUser(`${tag}@example.com`);
  const ws = await createWorkspace(ada.id, 'Acme', `ws-${tag}`);
  const ctx = (await resolveWorkspace(ada.id, ws.slug))!;
  const made = await createProject(ctx, { name: 'Web' });
  if (!made.ok) throw new Error(made.error);
  const project = (await getProject(ctx, made.data.id))!;
  return { ada, ws, ctx, project, statuses: project.statuses };
}

/** Calls a route handler the way Next does, and reads the JSON back. */
export async function call(
  handler: RouteHandler,
  opts: {
    path: string;
    method?: string;
    token?: string | null;
    authorization?: string;
    params?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
  },
) {
  const headers = new Headers();
  if (opts.authorization) headers.set('authorization', opts.authorization);
  else if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (body !== undefined) headers.set('content-type', 'application/json');

  const res = await handler(
    new Request(`http://localhost/api/v1${opts.path}`, { method: opts.method ?? 'GET', headers, body }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}
