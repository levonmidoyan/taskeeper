import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/align-tokens.css', 'utf8');

describe('align-tokens.css', () => {
  it('lets next-themes alone decide dark mode', () => {
    // A prefers-color-scheme block would force dark colours on a dark-OS user who
    // picked Light in the theme switcher.
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(/^\.dark \{/m);
  });

  it('emits every theme variable, including ones only .dark references', () => {
    expect(css).toMatch(/^@theme static \{/m);
    expect(css).toContain('--color-neutral-950');
  });

  it('carries the Align token families the components use', () => {
    for (const token of [
      '--color-bg-white-0', '--color-text-strong-950', '--color-stroke-soft-200',
      '--color-primary-base', '--text-label-sm', '--shadow-regular-xs', '--radius-10',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('is a partial, not a standalone stylesheet', () => {
    // globals.css owns the tailwindcss import and the body rules.
    expect(css).not.toContain('@import');
    expect(css).not.toMatch(/^body \{/m);
    expect(css).not.toContain('.remixicon');
  });
});
