import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = ['modal', 'drawer', 'popover', 'dropdown', 'select', 'tooltip'].map((f) => `src/components/ui/${f}.tsx`);

describe('UI primitives share the motion timing', () => {
  for (const file of files) {
    const src = readFileSync(file, 'utf8');

    it(`${file}: every enter animation sets a token duration and easing`, () => {
      // One class string per line in these files; each one that starts an animation
      // must also carry the shared duration and easing.
      for (const line of src.split('\n').filter((l) => /animate-in/.test(l))) {
        expect(line, line.trim()).toMatch(/duration-(120|180|280)/);
        expect(line, line.trim()).toMatch(/ease-out-soft/);
      }
    });

    it(`${file}: no default 200ms hover transitions`, () => {
      expect(src).not.toMatch(/duration-200 ease-out\b/);
    });
  }
});
