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

type Token = { type?: string; text?: string; raw?: string; block?: boolean; tokens?: Token[] };
type MarkdownManagerInternals = {
  parseHTMLToken(token: Token): unknown;
  htmlAsLiteralText(html: string, block: boolean): unknown;
  parseFallbackToken(token: Token, parseImplicitEmptyParagraphs?: boolean): unknown;
  parseInlineTokens(tokens: Token[]): unknown;
  getHandlerForToken(type: string): unknown;
};

/** Block tokens the stock fallback turns into content; anything else it would drop. */
const FALLBACK_BLOCKS = new Set(['paragraph', 'heading', 'text', 'html', 'escape', 'space']);
/** Inline tokens parseInlineTokens handles itself, without a registered handler. */
const BUILTIN_INLINE = new Set(['text', 'escape', 'html']);

/**
 * A block of source kept as typed: one paragraph, source lines as hard breaks. Trailing
 * spaces go: they are how a hard break is saved, so they would pile up on every save.
 */
function literalParagraph(raw: string) {
  const lines = raw.replace(/\s+$/, '').split('\n').map((line) => line.replace(/\s+$/, ''));
  return {
    type: 'paragraph',
    content: lines.flatMap((line, i) => [
      ...(i > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ type: 'text', text: line }] : []),
    ]),
  };
}

/**
 * Stored text was plain text before this editor existed, so "<div>" in it is a word. The
 * stock parser turns known HTML into nodes and drops the rest ("use <div> tags" becomes
 * "use  tags"); routing every HTML token through the manager's own literal-text path keeps
 * every character. The same goes for Markdown the editor has no node for — tables, images,
 * link reference definitions, footnotes: marked parses them and the stock parser drops them
 * (or keeps only an image's alt text), so the next save would delete them. They are kept as
 * the literal source instead. Uses @tiptap/markdown 3.31.3 internals —
 * tests/unit/editor-markdown.test.ts fails loudly if an upgrade renames them.
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

    const parseFallbackToken = manager.parseFallbackToken.bind(manager);
    manager.parseFallbackToken = (token, parseImplicitEmptyParagraphs) =>
      FALLBACK_BLOCKS.has(token.type ?? '') || !token.raw?.trim()
        ? parseFallbackToken(token, parseImplicitEmptyParagraphs)
        : literalParagraph(token.raw);

    const parseInlineTokens = manager.parseInlineTokens.bind(manager);
    manager.parseInlineTokens = (tokens) =>
      parseInlineTokens(
        tokens.map((token) =>
          token.type && !BUILTIN_INLINE.has(token.type) && !manager.getHandlerForToken(token.type)
            // An escape token's text is used verbatim (a text token's would be entity-decoded).
            ? { type: 'escape', raw: token.raw, text: token.raw }
            : token,
        ),
      );
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
