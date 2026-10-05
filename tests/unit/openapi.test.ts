import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { endpoints } from '@/server/api/contract';
import { buildOpenApi } from '@/server/api/openapi';

const V1 = resolve(__dirname, '../../src/app/api/v1');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : [];
  });
}

/** "workspaces/[slug]/tasks/route.ts" → "/workspaces/{slug}/tasks" */
function templateOf(file: string): string {
  const dir = relative(V1, file).replace(/\/?route\.ts$/, '');
  return `/${dir.replace(/\[([^\]]+)\]/g, '{$1}')}`;
}

describe('the contract registry', () => {
  it('declares exactly the methods the v1 route files export', () => {
    const served = routeFiles(V1)
      .filter((file) => !file.includes('openapi.json'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/export const (GET|POST|PATCH|DELETE)\b/g)]
        .map((m) => `${m[1]} ${templateOf(file)}`));
    const declared = endpoints.map((e) => `${e.method} ${e.path}`);

    expect(served.sort()).toEqual(declared.sort());
  });
});

describe('buildOpenApi', () => {
  const doc = buildOpenApi(endpoints, 'https://app.example') as {
    openapi: string;
    info: { title: string; version: string };
    servers: { url: string }[];
    paths: Record<string, Record<string, { operationId: string; parameters: { name: string; in: string; required: boolean }[]; responses: Record<string, unknown>; security: unknown[] }>>;
    components: { securitySchemes: Record<string, { type: string; scheme: string }>; schemas: Record<string, unknown> };
  };

  it('is an OpenAPI 3.1 document with bearer auth', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'Taskeeper API', version: '1' });
    expect(doc.servers).toEqual([{ url: 'https://app.example/api/v1' }]);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.components.schemas.Error).toBeDefined();
  });

  it('has every operation once, with unique operationIds, path params and responses', () => {
    const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.values(methods).map((op) => ({ path, op })));
    expect(ops).toHaveLength(endpoints.length);
    expect(new Set(ops.map(({ op }) => op.operationId)).size).toBe(ops.length);

    for (const { path, op } of ops) {
      for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
        expect(op.parameters, `${op.operationId} ${name}`).toContainEqual(expect.objectContaining({ name, in: 'path', required: true }));
      }
      expect(Object.keys(op.responses)).toContain('401');
      expect(Object.keys(op.responses).some((code) => code.startsWith('2'))).toBe(true);
      expect(op.security).toEqual([{ bearerAuth: [] }]);
    }
  });
});
