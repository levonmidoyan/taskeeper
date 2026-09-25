import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = 'src/components/ui';
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

describe('vendored Align components', () => {
  it('exist', () => {
    expect(files).toEqual(expect.arrayContaining([
      'button.tsx', 'input.tsx', 'label.tsx', 'select.tsx', 'modal.tsx', 'drawer.tsx',
      'dropdown.tsx', 'badge.tsx', 'avatar.tsx', 'radio.tsx', 'switch.tsx', 'tooltip.tsx',
    ]));
  });

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');

    it(`${file} uses Tabler icons only`, () => {
      expect(src).not.toMatch(/remixicon|lucide-react|\bRi[A-Z]\w+/);
    });

    it(`${file} has no Tailwind v3 arbitrary-variable shorthand`, () => {
      // v3's min-w-[--x] is a silent no-op in v4; it must be min-w-(--x).
      expect(src).not.toMatch(/-\[--/);
    });

    if (/from '@radix-ui\//.test(src)) {
      it(`${file} is a client module`, () => {
        expect(src).toMatch(/^(\/\/[^\n]*\n\n)?'use client';/);
      });
    }
  }

  it('modal and drawer close buttons have an accessible name', () => {
    for (const file of ['modal.tsx', 'drawer.tsx']) {
      expect(readFileSync(join(dir, file), 'utf8')).toContain("<span className='sr-only'>Close</span>");
    }
  });
});
