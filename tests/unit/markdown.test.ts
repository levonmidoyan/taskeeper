import { createElement } from 'react';
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

  it('wraps output in the shared md-content class', () => {
    expect(render('hi')).toMatch(/^<div class="md-content/);
  });
});
