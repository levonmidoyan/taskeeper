import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Server Components can only hand serializable props to Client Components. An icon
 * component (`as={IconX}`, `icon={IconX}`) or an inline function crashes the render at
 * runtime with "Functions cannot be passed directly to Client Components", and neither
 * tsc nor `next build` catches it for dynamic pages. This walks every module reachable
 * from a server entry in src/app and flags such props on elements imported from a
 * 'use client' module.
 */

const SRC = resolve(__dirname, '../../src');
const APP = join(SRC, 'app');
const ENTRY = /^(page|layout|template|default|not-found|loading)\.tsx$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function isClient(source: string) {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/.test(source);
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

type Finding = { file: string; line: number; text: string };

function check(): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const queue = walk(APP).filter((f) => ENTRY.test(f.split('/').pop()!));

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    if (isClient(text)) continue;

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    // Local name → whether it comes from a client module; plus names of icon imports.
    const clientNames = new Set<string>();
    const iconNames = new Set<string>();

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const names: string[] = [];
      if (clause.name) names.push(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
        else for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) names.push(el.name.text);
      }
      if (spec === '@tabler/icons-react') names.forEach((n) => iconNames.add(n));
      const target = resolveImport(file, spec);
      if (!target) continue;
      if (isClient(readFileSync(target, 'utf8'))) names.forEach((n) => clientNames.add(n));
      else queue.push(target);
    }

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let root: ts.Node = node.tagName;
        while (ts.isPropertyAccessExpression(root)) root = root.expression;
        if (ts.isIdentifier(root) && clientNames.has(root.text)) {
          for (const attr of node.attributes.properties) {
            if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer)) continue;
            const value = attr.initializer.expression;
            if (!value) continue;
            const bad =
              ts.isArrowFunction(value) ||
              ts.isFunctionExpression(value) ||
              (ts.isIdentifier(value) && iconNames.has(value.text)) ||
              // `as` takes a component; anything but a tag string is a function or forwardRef object.
              (attr.name.getText() === 'as' && !ts.isStringLiteral(value));
            if (bad) {
              const { line } = sf.getLineAndCharacterOfPosition(attr.getStart());
              findings.push({ file: relative(SRC, file), line: line + 1, text: attr.getText() });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

describe('RSC boundary', () => {
  it('server components pass no component or function props to client components', () => {
    expect(check()).toEqual([]);
  });
});
