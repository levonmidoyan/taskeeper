import { z } from 'zod';

export const API_ERROR_CODES = [
  'invalid_request', 'unauthorized', 'forbidden', 'not_found', 'unprocessable', 'rate_limited', 'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
};

/** Shown on /docs/api and in openapi.json. */
export const ERROR_DESCRIPTIONS: Record<ApiErrorCode, string> = {
  invalid_request: 'A path parameter, query parameter or the body failed validation, or the body is not JSON. `issues` says which.',
  unauthorized: 'The Authorization header is missing, or the token is malformed, unknown, revoked or expired.',
  forbidden: 'Your role in this workspace does not allow this.',
  not_found: 'The workspace, project, task or comment does not exist, or you are not a member of the workspace.',
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
