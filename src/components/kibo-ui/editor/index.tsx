'use client';

/**
 * Editor — trimmed from Kibo UI (haydenbleasel/kibo@3d63cdb15b79d972e3dc38a10997987672f9b263,
 * packages/editor/index.tsx). Kept: EditorProvider, EditorBubbleMenu, bold/italic/strike/code
 * buttons, link editing, placeholder, slash menu. Adapted:
 * - Tabler icons and Align CompactButton instead of lucide and shadcn Button/Tooltip.
 * - Buttons read active state with useEditorState, so they update on every selection change.
 * - Link editing happens inline inside the bubble menu. Kibo used a portaled Popover; focus
 *   leaving the menu element makes Tiptap hide the bubble menu, taking the popover with it.
 * - Links are limited to http(s)/mailto (normalizeLinkUrl).
 * - Removed: floating menu, node selector (the slash menu and Markdown shortcuts cover block
 *   types), tables, sub/superscript, underline, clear formatting, character count.
 * - `useEditorState`'s overload for `Editor | null` types the selector result as
 *   `T | null` (the editor may not be ready yet), so `active` is `boolean | null`; coerced
 *   to `active ?? false` for `aria-pressed`, which only accepts boolean/"true"/"false"/"mixed".
 * - handleEditorEscape: Radix dialogs catch Escape on the document in the capture phase, before
 *   the editor sees it, so a host dialog hands it to the editor before closing.
 */

import {
  IconBold, IconCheck, IconCode, IconItalic, IconLink, IconStrikethrough, IconUnlink,
  type TablerIcon,
} from '@tabler/icons-react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import {
  EditorProvider as TiptapEditorProvider,
  type EditorProviderProps as TiptapEditorProviderProps,
  useCurrentEditor,
  useEditorState,
} from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import { exitSuggestion } from '@tiptap/suggestion';
import { useMemo, useState } from 'react';
import * as CompactButton from '@/components/ui/compact-button';
import { markdownExtensions } from '@/components/kibo-ui/editor/extensions';
import { normalizeLinkUrl } from '@/components/kibo-ui/editor/link';
import { SlashCommand, slashPluginKey } from '@/components/kibo-ui/editor/slash';
import { cn } from '@/utils/cn';

export { loadMarkdown, readMarkdown } from '@/components/kibo-ui/editor/extensions';

export type EditorProviderProps = Omit<TiptapEditorProviderProps, 'extensions'> & {
  className?: string;
  placeholder?: string;
  extensions?: AnyExtension[];
};

export function EditorProvider({ className, placeholder, extensions, ...props }: EditorProviderProps) {
  // Stable across renders, so the editor is not rebuilt on every parent render.
  const allExtensions = useMemo(
    () => [
      ...markdownExtensions(),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          'before:pointer-events-none before:float-left before:h-0 before:text-text-soft-400 before:content-[attr(data-placeholder)]',
      }),
      SlashCommand,
      ...(extensions ?? []),
    ],
    [placeholder, extensions],
  );

  return (
    <div className={cn(className, '[&_.ProseMirror-focused]:outline-none')}>
      <TiptapEditorProvider extensions={allExtensions} immediatelyRender={false} {...props} />
    </div>
  );
}

/**
 * Lets Escape close the slash menu or the link field instead of a surrounding dialog. Call it
 * from the dialog's onEscapeKeyDown and preventDefault when it returns true. The dialog sees
 * Escape first (Radix listens on the document in the capture phase) and its preventDefault
 * makes ProseMirror skip the key, so the slash menu is closed here rather than by the editor.
 */
export function handleEditorEscape(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  // The link field closes itself from its own React onKeyDown.
  if (target.closest('[data-editor-link-form]')) return true;
  const dom = target.closest<HTMLElement & { editor?: Editor }>('.ProseMirror');
  if (!dom?.editor || !slashPluginKey.getState(dom.editor.state)?.active) return false;
  // A menu with no matches is hidden; Escape then belongs to the dialog.
  if (!document.querySelector('#slash-command')?.closest('.tippy-box[data-state="visible"]')) return false;
  exitSuggestion(dom.editor.view, slashPluginKey);
  return true;
}

export function EditorBubbleMenu({ className, children, ...props }: Omit<BubbleMenuProps, 'editor'>) {
  const { editor } = useCurrentEditor();
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      className={cn(
        'flex items-center gap-0.5 rounded-10 bg-bg-white-0 p-1 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200',
        className,
      )}
      {...props}
    >
      {children}
    </BubbleMenu>
  );
}

function FormatButton({
  label,
  icon,
  isActive,
  run,
}: {
  label: string;
  icon: TablerIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}) {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: (ctx) => (ctx.editor ? isActive(ctx.editor) : false),
  });
  if (!editor) return null;

  return (
    <CompactButton.Root
      type="button"
      variant="ghost"
      size="medium"
      aria-label={label}
      aria-pressed={active ?? false}
      onClick={() => run(editor)}
      className={cn(active && 'bg-bg-weak-50 text-text-strong-950')}
    >
      <CompactButton.Icon as={icon} />
    </CompactButton.Root>
  );
}

export const EditorFormatBold = () => (
  <FormatButton label="Bold" icon={IconBold} isActive={(e) => e.isActive('bold')} run={(e) => e.chain().focus().toggleBold().run()} />
);
export const EditorFormatItalic = () => (
  <FormatButton label="Italic" icon={IconItalic} isActive={(e) => e.isActive('italic')} run={(e) => e.chain().focus().toggleItalic().run()} />
);
export const EditorFormatStrike = () => (
  <FormatButton label="Strikethrough" icon={IconStrikethrough} isActive={(e) => e.isActive('strike')} run={(e) => e.chain().focus().toggleStrike().run()} />
);
export const EditorFormatCode = () => (
  <FormatButton label="Inline code" icon={IconCode} isActive={(e) => e.isActive('code')} run={(e) => e.chain().focus().toggleCode().run()} />
);

export function EditorLinkControl() {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: (ctx) => ctx.editor?.isActive('link') ?? false,
  });
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  if (!editor) return null;

  if (!editing) {
    return (
      <CompactButton.Root
        type="button"
        variant="ghost"
        size="medium"
        aria-label="Link"
        aria-pressed={active ?? false}
        onClick={() => {
          setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
          setInvalid(false);
          setEditing(true);
        }}
        className={cn(active && 'bg-bg-weak-50 text-primary-base')}
      >
        <CompactButton.Icon as={IconLink} />
      </CompactButton.Root>
    );
  }

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The bubble menu is a portal, so React bubbles this submit to whatever form holds the
    // editor — the comment composer would post the comment.
    event.stopPropagation();
    const href = normalizeLinkUrl(url);
    if (!href) {
      setInvalid(true);
      return;
    }
    editor!.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setEditing(false);
  }

  return (
    <form onSubmit={apply} data-editor-link-form className="flex items-center gap-1">
      <input
        autoFocus
        aria-label="Link URL"
        aria-invalid={invalid || undefined}
        value={url}
        onChange={(event) => { setUrl(event.target.value); setInvalid(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
            editor.commands.focus();
          }
        }}
        placeholder="Paste a link"
        className={cn(
          'h-8 w-48 rounded-lg bg-bg-weak-50 px-2 text-paragraph-sm text-text-strong-950 placeholder:text-text-soft-400',
          invalid && 'ring-1 ring-inset ring-error-base',
        )}
      />
      <CompactButton.Root type="submit" variant="ghost" size="medium" aria-label="Apply link">
        <CompactButton.Icon as={IconCheck} />
      </CompactButton.Root>
      {active && (
        <CompactButton.Root
          type="button"
          variant="ghost"
          size="medium"
          aria-label="Remove link"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setEditing(false);
          }}
        >
          <CompactButton.Icon as={IconUnlink} />
        </CompactButton.Root>
      )}
    </form>
  );
}
