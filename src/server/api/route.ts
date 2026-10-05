import type { z } from 'zod';
import type { Result } from '@/lib/result';
import { resolveWorkspace, type UserContext, type WorkspaceContext } from '@/lib/session';
import { authenticateRequest } from './auth';
import type { Endpoint } from './contract/types';
import { apiError, MAX_BODY_BYTES, NO_STORE, UNAUTHORIZED_MESSAGE, type ApiIssue } from './errors';
import { hitRateLimit } from './rate-limit';

export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

type Parsed<S> = S extends z.ZodType ? z.output<S> : Record<string, never>;

export type HandlerInput<E extends Endpoint> = {
  /** The token owner, inside the workspace when the route has one: the actor for activity and permissions. */
  ctx: E['workspace'] extends true ? WorkspaceContext : UserContext;
  params: Parsed<E['params']>;
  query: Parsed<E['query']>;
  body: E['body'] extends z.ZodType ? z.output<E['body']> : undefined;
};

const NOT_FOUND = 'Not found.';
const INTERNAL = 'Something went wrong.';

function parse(schema: z.ZodType | undefined, raw: unknown, where: string, issues: ApiIssue[]): unknown {
  if (!schema) return {};
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    issues.push({ path: [where, ...issue.path.map(String)].join('.'), message: issue.message });
  }
  return undefined;
}

/** Query parameters as an object. A repeated one is an issue: neither value may silently win. */
function queryOf(url: string, issues: ApiIssue[]): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (Object.hasOwn(query, key)) {
      if (!issues.some((i) => i.path === `query.${key}`)) issues.push({ path: `query.${key}`, message: 'Send this parameter once.' });
    } else {
      query[key] = value;
    }
  }
  return query;
}

/** The body as text, or null once it passes MAX_BODY_BYTES: read no further than that. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(result: Extract<Result<unknown>, { ok: false }>): Response {
  switch (result.code) {
    case 'forbidden': return apiError('forbidden', result.error);
    case 'not_found': return apiError('not_found', result.error);
    case 'internal': return apiError('internal', INTERNAL);
    default: return apiError('unprocessable', result.error);
  }
}

/**
 * Builds a route handler for one contract endpoint (spec §3): authenticate,
 * rate-limit, resolve the workspace, validate, call, map the Result.
 */
export function apiRoute<const E extends Endpoint>(
  endpoint: E,
  handler: (input: HandlerInput<E>) => Promise<Result<unknown>>,
): RouteHandler {
  return async (request, context) => {
    try {
      const principal = await authenticateRequest(request);
      if (!principal) return apiError('unauthorized', UNAUTHORIZED_MESSAGE);

      const limit = await hitRateLimit(principal.tokenId);
      if (!limit.ok) {
        return apiError('rate_limited', `Too many requests. Try again in ${limit.retryAfter} s.`, {
          headers: { 'Retry-After': String(limit.retryAfter) },
        });
      }

      const rawParams = (await context?.params) ?? {};
      let ctx: UserContext | WorkspaceContext = { userId: principal.userId };
      if (endpoint.workspace) {
        // Same 404 as the UI: a non-member must not learn which slugs exist.
        const resolved = await resolveWorkspace(principal.userId, rawParams.slug ?? '');
        if (!resolved) return apiError('not_found', NOT_FOUND);
        ctx = resolved;
      }

      const issues: ApiIssue[] = [];
      const params = parse(endpoint.params, rawParams, 'params', issues);
      const query = parse(endpoint.query, endpoint.query && queryOf(request.url, issues), 'query', issues);
      let body: unknown;
      if (endpoint.body) {
        const text = await readBody(request);
        if (text === null) return apiError('payload_too_large', `The body must be at most ${MAX_BODY_BYTES / 1024} KB.`);
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return apiError('invalid_request', 'The body must be valid JSON.');
        }
        body = parse(endpoint.body, raw, 'body', issues);
      }
      if (issues.length > 0) return apiError('invalid_request', 'The request is not valid.', { issues });

      const result = await handler({ ctx, params, query, body } as HandlerInput<E>);
      if (!result.ok) return failure(result);
      if (endpoint.status === 204) return new Response(null, { status: 204, headers: NO_STORE });
      return Response.json(result.data, { status: endpoint.status, headers: NO_STORE });
    } catch (error) {
      console.error('[api]', error);
      return apiError('internal', INTERNAL);
    }
  };
}
