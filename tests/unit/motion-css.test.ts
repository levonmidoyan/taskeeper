import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOTION_CLASSES } from '@/lib/motion';

const css = readFileSync('src/app/globals.css', 'utf8');

describe('globals.css motion', () => {
  it('defines the easing tokens', () => {
    expect(css).toMatch(/--ease-out-soft:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
    expect(css).toMatch(/--ease-spring:\s*linear\(/);
  });

  it('swaps the page instantly so only named parts animate', () => {
    expect(css).toMatch(/::view-transition-old\(root\)\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/::view-transition-new\(root\)\s*\{\s*animation:\s*none;/);
    // Without this the root group keeps the UA's 250 ms morph, and React holds every
    // later commit until it ends — even for a transition whose classes are all 'none'.
    expect(css).toMatch(/::view-transition-group\(root\)\s*\{\s*animation:\s*none;/);
    expect(css).toMatch(/::view-transition\s*\{\s*pointer-events:\s*none;/);
  });

  it('has a rule for every view-transition class the components use', () => {
    for (const cls of MOTION_CLASSES) expect(css, cls).toContain(`(.${cls})`);
  });

  it('turns view transitions off for reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/::view-transition-group\(\*\)/);
    expect(reduced).toMatch(/\.animate-kanban-lift[^{]*\{\s*animation:\s*none !important;/);
  });
});
