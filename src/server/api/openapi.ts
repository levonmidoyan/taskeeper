import { API_RATE_LIMIT } from '@/lib/api-tokens';
import { ENDPOINT_GROUPS, errorCodes, type Endpoint } from './contract/types';
import { jsonSchemaOf, parameterRows } from './docs';
import { apiErrorShape, ERROR_DESCRIPTIONS, ERROR_STATUS } from './errors';

const SUCCESS: Record<Endpoint['status'], string> = { 200: 'OK', 201: 'Created', 204: 'No content' };

/** OpenAPI 3.1 from the contract registry. No generator library: z.toJSONSchema does the schemas. */
export function buildOpenApi(list: readonly Endpoint[], origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const e of list) {
    const responses: Record<string, unknown> = {
      [e.status]: e.response
        ? { description: SUCCESS[e.status], content: { 'application/json': { schema: jsonSchemaOf(e.response, 'output') } } }
        : { description: SUCCESS[e.status] },
    };
    for (const code of errorCodes(e)) {
      responses[ERROR_STATUS[code]] = {
        description: `${code}: ${ERROR_DESCRIPTIONS[code]}`,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      };
    }

    (paths[e.path] ??= {})[e.method.toLowerCase()] = {
      operationId: e.operationId,
      summary: e.summary,
      description: e.description,
      tags: [e.group],
      security: [{ bearerAuth: [] }],
      parameters: parameterRows(e).map((p) => ({
        name: p.name, in: p.in, required: p.required, schema: p.schema,
        ...(p.description && { description: p.description }),
      })),
      ...(e.body && {
        requestBody: { required: true, content: { 'application/json': { schema: jsonSchemaOf(e.body, 'input') } } },
      }),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Taskeeper API',
      version: '1',
      description: `Personal-token JSON API. ${API_RATE_LIMIT} requests per minute per token. Reference: ${origin}/docs/api`,
    },
    servers: [{ url: `${origin}/api/v1` }],
    tags: ENDPOINT_GROUPS.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'A personal API token (tk_…) from Account → API tokens.' },
      },
      schemas: { Error: jsonSchemaOf(apiErrorShape, 'output') },
    },
  };
}
