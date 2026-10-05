import type { z } from 'zod';
import type { ApiErrorCode } from '../errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export const ENDPOINT_GROUPS = ['Account', 'Workspaces', 'Projects', 'Tasks', 'Comments'] as const;
export type EndpointGroup = (typeof ENDPOINT_GROUPS)[number];

/**
 * One endpoint, declared once. apiRoute validates against these schemas and
 * openapi.json and /docs/api are generated from them, so the three cannot disagree.
 */
export type Endpoint = {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI template relative to /api/v1, e.g. '/workspaces/{slug}/tasks/{taskId}'. */
  path: string;
  group: EndpointGroup;
  summary: string;
  description: string;
  /** True when the path starts with /workspaces/{slug}: the workspace is resolved before validation. */
  workspace: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  status: 200 | 201 | 204;
  /** Omitted for 204. */
  response?: z.ZodType;
  /** Errors beyond the ones every endpoint of its kind can return (see errorCodes). */
  errors: readonly ApiErrorCode[];
  /** For the curl example on /docs/api. */
  example?: { query?: Record<string, string>; body?: unknown };
};

export function defineEndpoint<const E extends Endpoint>(endpoint: E): E {
  return endpoint;
}

/** Every error an endpoint can return, in a stable order. */
export function errorCodes(endpoint: Endpoint): ApiErrorCode[] {
  const codes = new Set<ApiErrorCode>(['unauthorized', 'rate_limited']);
  if (endpoint.params || endpoint.query || endpoint.body) codes.add('invalid_request');
  if (endpoint.workspace) codes.add('not_found');
  for (const code of endpoint.errors) codes.add(code);
  codes.add('internal');
  const order: ApiErrorCode[] = ['invalid_request', 'unauthorized', 'forbidden', 'not_found', 'unprocessable', 'rate_limited', 'internal'];
  return order.filter((c) => codes.has(c));
}
