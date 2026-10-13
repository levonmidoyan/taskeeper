// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMarkdown, markdownExtensions, readMarkdown } from '@/components/kibo-ui/editor/extensions';
import { createMentionExtension } from '@/components/kibo-ui/editor/mention';

const editors: Editor[] = [];
function open(markdown: string) {
  const editor = new Editor({ extensions: [...markdownExtensions(), createMentionExtension(() => [])] });
  loadMarkdown(editor, markdown);
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
const hasMention = (e: Editor) => JSON.stringify(e.getJSON()).includes('"type":"mention"');

describe('mention Markdown', () => {
  it.each([
    'hi [@Ana Petrosyan](mention:usr_1) there',
    '[@Ana](mention:a) and [@Bo](mention:b)',
    '- item [@Ana](mention:a)',
    '[site](https://example.com) [@Ana](mention:a)',
    '[@Odd \\] name](mention:x1)',
  ])('round trips %j as a mention node', (markdown) => {
    const editor = open(markdown);
    expect(hasMention(editor)).toBe(true);
    expect(readMarkdown(editor)).toBe(markdown);
  });

  it('keeps mention-shaped code as text', () => {
    const editor = open('`[@Ana](mention:a)`');
    expect(hasMention(editor)).toBe(false);
    expect(readMarkdown(editor)).toBe('`[@Ana](mention:a)`');
  });

  it('keeps a plain link a link', () => {
    const editor = open('[site](https://example.com)');
    expect(hasMention(editor)).toBe(false);
  });

  it('Backspace removes a mention whole', () => {
    const editor = open('hi [@Ana](mention:a)');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.keyboardShortcut('Backspace');
    expect(hasMention(editor)).toBe(false);
    expect(readMarkdown(editor)).not.toContain('@');
  });

  it('saves an inserted mention in link form', () => {
    const editor = open('hi ');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, { type: 'mention', attrs: { id: 'u9', label: 'Zed' } });
    expect(readMarkdown(editor)).toBe('hi [@Zed](mention:u9)');
  });
});
