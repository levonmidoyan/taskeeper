import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Badge from '@/components/ui/badge';
import * as Button from '@/components/ui/button';
import * as Input from '@/components/ui/input';

describe('Align components render with Align token classes', () => {
  it('Button', () => {
    const html = renderToStaticMarkup(createElement(Button.Root, { type: 'submit' }, 'Save'));
    expect(html).toContain('>Save<');
    expect(html).toContain('bg-primary-base');
    expect(html).toContain('text-label-sm');
  });

  it('Badge', () => {
    const html = renderToStaticMarkup(
      createElement(Badge.Root, { variant: 'lighter', color: 'red' }, 'Overdue'),
    );
    expect(html).toContain('Overdue');
  });

  it('Input keeps the id so a <label htmlFor> can name it', () => {
    const html = renderToStaticMarkup(
      createElement(Input.Root, null,
        createElement(Input.Wrapper, null, createElement(Input.Input, { id: 'email' }))),
    );
    expect(html).toContain('id="email"');
  });
});
