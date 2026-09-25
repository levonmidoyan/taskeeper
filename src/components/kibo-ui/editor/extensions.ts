/**
 * Editor extension set — trimmed from Kibo UI's editor
 * (haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263, packages/editor/index.tsx):
 * only nodes and marks with a Markdown form are kept (spec §6.1). Dropped: tables,
 * sub/superscript, text style, underline, lowlight, character count, typography (it rewrites
 * "--" and quotes as you type, which mangles CLI flags and code in descriptions).
 * Added: @tiptap/markdown for Markdown in and out.
 * - `onBeforeCreate`'s typed signature takes the `beforeCreate` event and requires `this.parent`
 *   to be called with it (`this.parent?.(event)`), not `this.parent?.()`.
 */
import type { AnyExtension, Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

type HtmlToken = { text?: string; raw?: string; block?: boolean };
type MarkdownManagerInternals = {
  parseHTMLToken(token: HtmlToken): unknown;
  htmlAsLiteralText(html: string, block: boolean): unknown;
};

/**
 * Stored text was plain text before this editor existed, so "<div>" in it is a word. The
 * stock parser turns known HTML into nodes and drops the rest ("use <div> tags" becomes
 * "use  tags"); routing every HTML token through the manager's own literal-text path keeps
 * every character. Uses @tiptap/markdown 3.31.3 internals — tests/unit/editor-markdown.test.ts
 * fails loudly if an upgrade renames them.
 */
const LiteralHtmlMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = this.editor.markdown as unknown as MarkdownManagerInternals | undefined;
    if (!manager) return;
    manager.parseHTMLToken = (token) => {
      const html = token.text || token.raw || '';
      return html.trim() ? manager.htmlAsLiteralText(html, !!token.block) : null;
    };
  },
});

export function markdownExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--color-primary-base)', width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // breaks: a single newline is a line break, as it was in the old plain text.
    LiteralHtmlMarkdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

/**
 * Loads Markdown after the editor exists. Passing it as initial `content` would parse it
 * inside the Markdown extension's own onBeforeCreate — before LiteralHtmlMarkdown's patch.
 */
export function loadMarkdown(editor: Editor, markdown: string) {
  editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
}

export function readMarkdown(editor: Editor) {
  return editor.getMarkdown().trim();
}
