import { describe, expect, it } from 'vitest';
import { codeLanguage } from '@/lib/code-language';

describe('codeLanguage', () => {
  it('picks the grammar by extension', () => {
    expect(codeLanguage('app.tsx', 'application/octet-stream')).toBe('tsx');
    expect(codeLanguage('app.ts', 'video/mp2t')).toBe('typescript');
    expect(codeLanguage('index.mjs', '')).toBe('javascript');
    expect(codeLanguage('main.py', '')).toBe('python');
    expect(codeLanguage('logo.SVG', 'image/svg+xml')).toBe('xml');
    expect(codeLanguage('README.md', '')).toBe('markdown');
    expect(codeLanguage('lib.rs', '')).toBe('rust');
    expect(codeLanguage('x.hpp', '')).toBe('cpp');
  });
  it('falls back to the type when the extension says nothing', () => {
    expect(codeLanguage('data', 'application/json')).toBe('json');
    expect(codeLanguage('page', 'text/html')).toBe('html');
  });
  it('is null for source with no grammar', () => {
    expect(codeLanguage('run.sh', 'application/x-sh')).toBeNull();
    expect(codeLanguage('Gemfile.rb', '')).toBeNull();
  });
});
