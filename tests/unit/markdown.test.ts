import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/task/Markdown';

const render = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

describe('Markdown', () => {
  it('renders emphasis, lists and task lists', () => {
    expect(render('Ship **today**')).toContain('<strong>today</strong>');
    expect(render('- one\n- two')).toContain('<li>one</li>');
    expect(render('- [x] done')).toContain('type="checkbox"');
  });

  it('keeps single line breaks from old plain-text rows', () => {
    expect(render('line one\nline two')).toMatch(/line one<br\/?>/);
  });

  it('shows raw HTML as literal text instead of dropping or executing it', () => {
    // Old rows are plain text; "use <div> tags" must not lose "<div>".
    expect(render('use <div> tags')).toContain('use &lt;div&gt; tags');
    const script = render('<script>alert(1)</script>');
    expect(script).not.toContain('<script');
    expect(script).toContain('&lt;script&gt;');
    expect(render('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('neutralises javascript: links and opens real links safely', () => {
    expect(render('[x](javascript:alert(1))')).not.toContain('javascript:');
    const link = render('[site](https://example.com)');
    expect(link).toContain('href="https://example.com"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it('shows an image as a link instead of loading it', () => {
    // A remote image loads in every viewer's browser (a tracking pixel); the editor has no
    // image node either, so it would only ever come from pasted or old text.
    const image = render('see ![logo](https://x.com/a.png) here');
    expect(image).not.toContain('<img');
    expect(image).toContain('href="https://x.com/a.png"');
    expect(image).toContain('>logo</a>');
    expect(render('![](https://x.com/b.png)')).toContain('>https://x.com/b.png</a>');
  });

  it('wraps output in the shared md-content class', () => {
    expect(render('hi')).toMatch(/^<div class="md-content/);
  });
});

describe('mentions', () => {
  const md = (body: string, props: Omit<ComponentProps<typeof Markdown>, 'children'> = {}) =>
    renderToStaticMarkup(Markdown({ ...props, children: body }));
  const members = [{ userId: 'u1', name: 'Ana Petrosyan', email: 'a@x.com', image: null }];

  it('renders a mention as a chip, not a link', () => {
    const html = md('hi [@Ana](mention:u1)');
    expect(html).toContain('<span class="mention">@Ana</span>');
    expect(html).not.toContain('href="mention:');
  });
  it('uses the current member name when known', () => {
    expect(md('[@Ana](mention:u1)', { members })).toContain('>@Ana Petrosyan</span>');
  });
  it('falls back to the stored name for an ex-member', () => {
    expect(md('[@Gone](mention:zz)', { members })).toContain('>@Gone</span>');
  });
  it('marks my own mention', () => {
    expect(md('[@Ana](mention:u1)', { currentUserId: 'u1' })).toContain('data-self');
  });
  it('still neutralises javascript: links', () => {
    expect(md('[x](javascript:alert(1))')).not.toContain('javascript:');
  });
});
