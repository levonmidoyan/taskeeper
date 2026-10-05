import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closeDb, db, resetDb } from '../setup/db';
import { apiFixture, apiUser, call } from '../setup/api';
import { createUser, createWorkspace } from '../setup/factories';
import { apiRateLimit } from '@/db';
import { err, ok } from '@/lib/result';
import { createApiToken, revokeApiToken } from '@/server/api-tokens/service';
import { defineEndpoint } from '@/server/api/contract/types';
import { apiRoute } from '@/server/api/route';

beforeEach(resetDb);
afterAll(closeDb);

const base = { group: 'Account', summary: 'Test', description: 'Test', errors: [] } as const;

const whoami = apiRoute(
  defineEndpoint({ ...base, operationId: 'whoami', method: 'GET', path: '/whoami', workspace: false, status: 200 }),
  async ({ ctx }) => ok({ userId: ctx.userId }),
);

const inWorkspace = apiRoute(
  defineEndpoint({
    ...base, operationId: 'inWs', method: 'POST', path: '/workspaces/{slug}/things', workspace: true, status: 201,
    params: z.object({ slug: z.string() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(10).default(5) }),
    body: z.object({ title: z.string().min(1) }),
  }),
  async ({ ctx, query, body }) => ok({ userId: ctx.userId, role: ctx.role, limit: query.limit, title: body.title }),
);

const failing = (result: () => Promise<never>) =>
  apiRoute(defineEndpoint({ ...base, operationId: 'f', method: 'DELETE', path: '/f', workspace: false, status: 204 }), result);

const gone = apiRoute(
  defineEndpoint({ ...base, operationId: 'gone', method: 'DELETE', path: '/gone', workspace: false, status: 204 }),
  async () => ok(null),
);

describe('apiRoute: authentication', () => {
  it('gives one identical 401 for every way a token can be wrong', async () => {
    const ada = await createUser('r1@example.com');
    const revoked = await createApiToken({ userId: ada.id }, { name: 'r', expiresInDays: null });
    const expired = await createApiToken({ userId: ada.id }, { name: 'e', expiresInDays: 30 }, new Date(Date.now() - 31 * 86_400_000));
    if (!revoked.ok || !expired.ok) throw new Error('setup');
    await revokeApiToken({ userId: ada.id }, revoked.data.id);

    const attempts = [
      {},
      { authorization: `Basic ${revoked.data.token}` },
      { authorization: 'Bearer not-a-token' },
      { token: `tk_${'z'.repeat(43)}` },
      { token: revoked.data.token },
      { token: expired.data.token },
    ];
    for (const auth of attempts) {
      const res = await call(whoami, { path: '/whoami', ...auth });
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: { code: 'unauthorized', message: 'Missing or invalid API token.' } });
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('acts as the token owner', async () => {
    const ada = await apiUser('r2@example.com');
    const res = await call(whoami, { path: '/whoami', token: ada.token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ userId: ada.id });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('apiRoute: rate limit', () => {
  it('429s with Retry-After once the window is used up', async () => {
    const ada = await apiUser('r3@example.com');
    // Both this minute and the next, so the test cannot straddle a window edge.
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    await db.insert(apiRateLimit).values([
      { tokenId: ada.tokenId, windowStart: new Date(minute), count: 120 },
      { tokenId: ada.tokenId, windowStart: new Date(minute + 60_000), count: 120 },
    ]);

    const res = await call(whoami, { path: '/whoami', token: ada.token });

    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe('rate_limited');
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });
});

describe('apiRoute: workspace and validation', () => {
  it('404s an unknown slug and a non-member slug with the same body, before validating', async () => {
    const { ada } = await apiFixture('r4');
    const eve = await createUser('r4-eve@example.com');
    await createWorkspace(eve.id, 'Secret', 'ws-r4-secret');

    const unknown = await call(inWorkspace, { method: 'POST', path: '/workspaces/nope/things', token: ada.token, params: { slug: 'nope' }, body: {} });
    const foreign = await call(inWorkspace, { method: 'POST', path: '/workspaces/ws-r4-secret/things', token: ada.token, params: { slug: 'ws-r4-secret' }, body: {} });

    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.json).toEqual(unknown.json);
    expect(unknown.json).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('400s bad query and body with every issue', async () => {
    const { ada, ws } = await apiFixture('r5');
    const res = await call(inWorkspace, {
      method: 'POST', path: `/workspaces/${ws.slug}/things?limit=99`, token: ada.token, params: { slug: ws.slug }, body: { title: '' },
    });

    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('invalid_request');
    expect(res.json.error.issues.map((i: { path: string }) => i.path).sort()).toEqual(['body.title', 'query.limit']);
  });

  it('400s a body that is not JSON', async () => {
    const { ada, ws } = await apiFixture('r6');
    const res = await call(inWorkspace, { method: 'POST', path: `/workspaces/${ws.slug}/things`, token: ada.token, params: { slug: ws.slug }, rawBody: '{nope' });
    expect(res.status).toBe(400);
    expect(res.json.error).toEqual({ code: 'invalid_request', message: 'The body must be valid JSON.' });
  });

  it('hands the handler the real workspace context and parsed input, and answers 201', async () => {
    const { ada, ws } = await apiFixture('r7');
    const res = await call(inWorkspace, { method: 'POST', path: `/workspaces/${ws.slug}/things`, token: ada.token, params: { slug: ws.slug }, body: { title: 'Hi' } });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ userId: ada.id, role: 'owner', limit: 5, title: 'Hi' });
  });
});

describe('apiRoute: result mapping', () => {
  it('maps failure codes to 403 / 404 / 422 / 500', async () => {
    const ada = await apiUser('r8@example.com');
    const cases: [ReturnType<typeof err>, number, string, string][] = [
      [err('No.', 'forbidden'), 403, 'forbidden', 'No.'],
      [err('Task not found.', 'not_found'), 404, 'not_found', 'Task not found.'],
      [err('That column does not belong to this project.'), 422, 'unprocessable', 'That column does not belong to this project.'],
      [err('Something went wrong. Please try again.', 'internal'), 500, 'internal', 'Something went wrong.'],
    ];
    for (const [result, status, code, message] of cases) {
      const res = await call(failing(async () => result as never), { method: 'DELETE', path: '/f', token: ada.token });
      expect(res.status).toBe(status);
      expect(res.json).toEqual({ error: { code, message } });
    }
  });

  it('turns a thrown error into a generic 500', async () => {
    const ada = await apiUser('r9@example.com');
    const res = await call(failing(async () => { throw new Error('relation "task" does not exist'); }), { method: 'DELETE', path: '/f', token: ada.token });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: { code: 'internal', message: 'Something went wrong.' } });
  });

  it('answers 204 with no body', async () => {
    const ada = await apiUser('r10@example.com');
    const res = await call(gone, { method: 'DELETE', path: '/gone', token: ada.token });
    expect(res.status).toBe(204);
    expect(res.json).toBeNull();
  });
});
