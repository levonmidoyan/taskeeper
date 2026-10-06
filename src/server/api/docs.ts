import { z } from 'zod';
import { ENDPOINT_GROUPS, type Endpoint, type EndpointGroup } from './contract/types';

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
};

/** Zod → JSON Schema (2020-12, which OpenAPI 3.1 uses), minus the $schema line. */
export function jsonSchemaOf(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema;
  delete json.$schema;
  return json;
}

export function typeLabel(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.anyOf) return s.anyOf.map(typeLabel).join(' | ');
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (types.length === 0) return 'any';
  return types.map((t) => (t === 'array' ? `${s.items ? typeLabel(s.items) : 'any'}[]` : t)).join(' | ');
}

export type SchemaField = {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  children: SchemaField[];
};

/** The object a field's children live in: itself, its array items, or a nullable branch. */
function objectOf(s: JsonSchema): JsonSchema | null {
  if (s.properties) return s;
  if (s.items) return objectOf(s.items);
  for (const option of s.anyOf ?? []) {
    const found = objectOf(option);
    if (found) return found;
  }
  return null;
}

export function schemaFields(schema: JsonSchema): SchemaField[] {
  const obj = objectOf(schema);
  if (!obj?.properties) return [];
  const required = new Set(obj.required ?? []);
  return Object.entries(obj.properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop),
    required: required.has(name),
    description: prop.description ?? null,
    children: schemaFields(prop),
  }));
}

export type ParamRow = {
  name: string;
  in: 'path' | 'query';
  type: string;
  required: boolean;
  description: string | null;
  schema: JsonSchema;
};

export function parameterRows(endpoint: Endpoint): ParamRow[] {
  const rows = (schema: z.ZodType | undefined, where: 'path' | 'query'): ParamRow[] => {
    if (!schema) return [];
    const json = jsonSchemaOf(schema, 'input');
    const required = new Set(json.required ?? []);
    return Object.entries(json.properties ?? {}).map(([name, prop]) => ({
      name,
      in: where,
      type: typeLabel(prop),
      required: where === 'path' || required.has(name),
      description: prop.description ?? null,
      schema: prop,
    }));
  };
  return [...rows(endpoint.params, 'path'), ...rows(endpoint.query, 'query')];
}

export function curlExample(endpoint: Endpoint, origin: string): string {
  const query = endpoint.example?.query ? `?${new URLSearchParams(endpoint.example.query)}` : '';
  const method = endpoint.method === 'GET' ? '' : ` -X ${endpoint.method}`;
  const lines = [
    `curl${method} "${origin}/api/v1${endpoint.path}${query}"`,
    '  -H "Authorization: Bearer $TASKEEPER_TOKEN"',
  ];
  if (endpoint.example?.body !== undefined) {
    lines.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(endpoint.example.body)}'`);
  }
  return lines.join(' \\\n');
}

export function groupEndpoints(list: readonly Endpoint[]): { group: EndpointGroup; endpoints: Endpoint[] }[] {
  return ENDPOINT_GROUPS
    .map((group) => ({ group, endpoints: list.filter((e) => e.group === group) }))
    .filter((g) => g.endpoints.length > 0);
}
