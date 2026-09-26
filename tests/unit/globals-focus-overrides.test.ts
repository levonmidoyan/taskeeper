import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');

describe('globals.css focus-ring overrides', () => {
  // Align's filled-button focus shadows ship at 10-16% alpha, which is close to invisible
  // against light surfaces (see align-tokens.css --shadow-button-*-focus). globals.css must
  // override them to solid rings while keeping Align's 2px surface gap.
  it('overrides --shadow-button-primary-focus to a solid ring', () => {
    expect(css).toMatch(
      /--shadow-button-primary-focus:\s*0 0 0 2px var\(--color-bg-white-0\), 0 0 0 4px var\(--color-primary-base\);/,
    );
  });

  it('overrides --shadow-button-important-focus to a solid ring', () => {
    expect(css).toMatch(
      /--shadow-button-important-focus:\s*0 0 0 2px var\(--color-bg-white-0\), 0 0 0 4px var\(--color-text-strong-950\);/,
    );
  });

  it('overrides --shadow-button-error-focus to a solid ring', () => {
    expect(css).toMatch(
      /--shadow-button-error-focus:\s*0 0 0 2px var\(--color-bg-white-0\), 0 0 0 4px var\(--color-error-base\);/,
    );
  });
});
