import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEndpoint } from '@/server/api/contract/types';
import { curlExample, jsonSchemaOf, parameterRows, schemaFields, typeLabel } from '@/server/api/docs';

describe('typeLabel', () => {
  it('names plain, nullable, enum and array types', () => {
    expect(typeLabel(jsonSchemaOf(z.string(), 'output'))).toBe('string');
    expect(typeLabel(jsonSchemaOf(z.string().nullable(), 'output'))).toBe('string | null');
    expect(typeLabel(jsonSchemaOf(z.enum(['a', 'b']), 'output'))).toBe('"a" | "b"');
    expect(typeLabel(jsonSchemaOf(z.array(z.object({ id: z.string() })), 'output'))).toBe('object[]');
  });
});

describe('schemaFields', () => {
  it('walks nested objects, arrays of objects and nullable objects', () => {
    const shape = z.object({
      id: z.string().describe('The id.'),
      owner: z.object({ name: z.string() }).nullable(),
      tags: z.array(z.object({ id: z.string() })),
      note: z.string().optional(),
    });
    const fields = schemaFields(jsonSchemaOf(shape, 'output'));

    expect(fields.map((f) => [f.name, f.required])).toEqual([['id', true], ['owner', true], ['tags', true], ['note', false]]);
    expect(fields[0].description).toBe('The id.');
    expect(fields[1].children.map((c) => c.name)).toEqual(['name']);
    expect(fields[2].children.map((c) => c.name)).toEqual(['id']);
    expect(fields[3].children).toEqual([]);
  });
});

const sample = defineEndpoint({
  operationId: 'sample', method: 'POST', path: '/workspaces/{slug}/things', group: 'Tasks', summary: 'S', description: 'D',
  workspace: true, status: 201, errors: [],
  params: z.object({ slug: z.string() }),
  query: z.object({ limit: z.coerce.number().default(5).describe('Page size.'), q: z.string() }),
  body: z.object({ title: z.string() }),
  example: { query: { q: 'x y' }, body: { title: 'Hi' } },
});

describe('parameterRows', () => {
  it('lists path params as required and query params by their own rule', () => {
    expect(parameterRows(sample).map((r) => [r.name, r.in, r.required, r.type])).toEqual([
      ['slug', 'path', true, 'string'],
      ['limit', 'query', false, 'number'],
      ['q', 'query', true, 'string'],
    ]);
    expect(parameterRows(sample)[1].description).toBe('Page size.');
  });
});

describe('curlExample', () => {
  it('builds a runnable command with the token variable, query and JSON body', () => {
    expect(curlExample(sample, 'https://app.example')).toBe([
      'curl -X POST "https://app.example/api/v1/workspaces/{slug}/things?q=x+y" \\',
      '  -H "Authorization: Bearer $TASKEEPER_TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"title":"Hi"}'`,
    ].join('\n'));
  });
});
