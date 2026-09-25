import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles('src');
const read = (path: string) => readFileSync(path, 'utf8');

describe('UI dependency rules (spec §9)', () => {
  it('has none of the removed UI packages', () => {
    for (const name of ['radix-ui', 'lucide-react', 'shadcn', 'cn', 'class-variance-authority']) {
      expect(deps, name).not.toHaveProperty(name);
    }
  });

  it('only keeps Radix primitives that an Align component imports', () => {
    const uiSources = files.filter((f) => f.startsWith(join('src', 'components', 'ui'))).map(read).join('\n');
    for (const name of Object.keys(deps).filter((d) => d.startsWith('@radix-ui/'))) {
      expect(uiSources, name).toContain(`'${name}'`);
    }
  });

  it('has no imports of removed icon or UI libraries, and no legacy-ui', () => {
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/from ['"](lucide-react|@remixicon\/react|radix-ui)['"]/);
      expect(src, file).not.toContain('legacy-ui');
    }
  });

  it('keeps hex colours out of app code', () => {
    // Vendored Align/Kibo source keeps upstream's literal SVG fills and masks (spec §9).
    const vendored = [join('src', 'components', 'ui'), join('src', 'components', 'kibo-ui')];
    const appFiles = files.filter((f) => /\.tsx?$/.test(f) && !vendored.some((v) => f.startsWith(v)));
    for (const file of appFiles) {
      expect(read(file), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    }
  });
});
