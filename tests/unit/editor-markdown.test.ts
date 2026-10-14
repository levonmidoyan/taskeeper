// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMarkdown, markdownExtensions, readMarkdown } from '@/components/kibo-ui/editor/extensions';

const editors: Editor[] = [];
function open(markdown: string) {
  const editor = new Editor({ extensions: markdownExtensions() });
  loadMarkdown(editor, markdown);
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

describe('editor Markdown round trip', () => {
  it.each([
    '**bold** and *italic*',
    '~~gone~~',
    '`code`',
    '# Title',
    '## Sub',
    '### Small',
    '- one\n- two',
    '1. one\n2. two',
    '- [ ] todo\n- [x] done',
    '> quoted',
    '```\nconst a = 1;\n```',
    '[site](https://example.com)',
  ])('keeps %j', (markdown) => {
    expect(readMarkdown(open(markdown))).toBe(markdown);
  });

  it('is stable: saving what it loaded changes nothing further', () => {
    for (const markdown of [
      'line one\nline two', 'a < b', 'use <div> tags', '- [ ] todo',
      '| a | b |\n|---|---|\n| 1 | 2 |',
    ]) {
      const once = readMarkdown(open(markdown));
      expect(readMarkdown(open(once))).toBe(once);
    }
  });

  it('keeps raw HTML in old plain-text rows as literal text', () => {
    expect(open('use <div> tags').getText()).toBe('use <div> tags');
    expect(open('<script>alert(1)</script>').getText()).toBe('<script>alert(1)</script>');
    expect(open('wrap <b>this</b>').getText()).toBe('wrap <b>this</b>');
  });

  // Marked parses these, but the editor has no node for them; dropping them would delete them
  // from the row on the next save.
  it.each([
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['a link reference definition', '[ref]: https://x.com', '[ref]: https://x.com'],
    ['an image', 'see ![logo](https://x.com/a.png) here', 'see ![logo](https://x.com/a.png) here'],
  ])('keeps %s as literal text', (_, markdown, text) => {
    const editor = open(markdown);
    expect(editor.getText({ blockSeparator: '\n\n' })).toBe(text);
    // And it survives a save and reload.
    expect(open(readMarkdown(editor)).getText({ blockSeparator: '\n\n' })).toBe(text);
  });

  it('keeps an attachment image as an image node and round-trips it', () => {
    const markdown = 'see ![shot.png](/api/attachments/abc123) here';
    const editor = open(markdown);
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"image"');
    expect(readMarkdown(editor)).toBe(markdown);
  });

  it('makes no image node from pasted HTML with a remote image', () => {
    const editor = open('');
    editor.commands.setContent('<p><img src="https://x.com/a.png"></p>');
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"image"');
  });

  it('turns a single newline into a hard break', () => {
    const editor = open('line one\nline two');
    expect(JSON.stringify(editor.getJSON())).toContain('hardBreak');
    expect(editor.getText()).toBe('line one\nline two');
  });

  it('has no underline (no Markdown form)', () => {
    expect(open('x').extensionManager.extensions.map((e) => e.name)).not.toContain('underline');
  });
});
