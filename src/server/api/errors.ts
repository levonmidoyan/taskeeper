import { z } from 'zod';

export const API_ERROR_CODES = [
  'invalid_request', 'unauthorized', 'forbidden', 'not_found', 'payload_too_large', 'unprocessable', 'rate_limited', 'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
};

/** Request body cap: the largest valid body (10,000-character Markdown, every character escaped) fits with room to spare. */
export const MAX_BODY_BYTES = 128 * 1024;

/** Shown on /docs/api and in openapi.json. */
export const ERROR_DESCRIPTIONS: Record<ApiErrorCode, string> = {
  invalid_request: 'A path parameter, query parameter or the body failed validation, the body is not JSON, or a query parameter is repeated. `issues` says which.',
  unauthorized: 'The Authorization header is missing, or the token is malformed, unknown, revoked or expired.',
  forbidden: 'Your role in this workspace does not allow this.',
  not_found: 'The workspace, project, task or comment does not exist, you are not a member of the workspace, or the path is not an API endpoint.',
  payload_too_large: `The body is over ${MAX_BODY_BYTES / 1024} KB.`,
  unprocessable: 'The request was valid but the change was refused; `message` says why.',
  rate_limited: 'More than 120 requests in the current minute for this token. Wait `Retry-After` seconds.',
  internal: 'Something failed on our side. Retrying later is safe for GET requests.',
};

export type ApiIssue = { path: string; message: string };

export const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export const UNAUTHORIZED_MESSAGE = 'Missing or invalid API token.';

export const apiErrorShape = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional()
      .describe('Only on invalid_request.'),
  }),
});

export function apiError(
  code: ApiErrorCode,
  message: string,
  opts: { issues?: ApiIssue[]; headers?: Record<string, string> } = {},
): Response {
  return Response.json(
    { error: { code, message, ...(opts.issues && { issues: opts.issues }) } },
    { status: ERROR_STATUS[code], headers: { ...NO_STORE, ...opts.headers } },
  );
}
