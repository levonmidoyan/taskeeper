'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  EditorBubbleMenu, EditorFormatBold, EditorFormatCode, EditorFormatItalic,
  EditorFormatStrike, EditorLinkControl, EditorProvider, loadMarkdown, readMarkdown,
} from '@/components/kibo-ui/editor';
import { createMentionExtension, type MentionMember } from '@/components/kibo-ui/editor/mention';
import { cn } from '@/utils/cn';

export { handleEditorEscape } from '@/components/kibo-ui/editor';

type RichTextFieldProps = {
  /** Markdown shown at mount. Read once; remount with `key` to reset. */
  value: string;
  /** Accessible name (aria-label). Use this or `labelledBy`. */
  label?: string;
  /** Id of a visible element naming the field (aria-labelledby). */
  labelledBy?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  /** On blur, only when the Markdown differs from what was loaded or last committed. */
  onCommit?: (markdown: string) => void;
  className?: string;
  /** Puts the caret at the end once the editor mounts. */
  autoFocus?: boolean;
  /** Workspace members offered by the @ menu. Without it, @ is just a character. */
  members?: MentionMember[];
};

export function RichTextField({
  value, label, labelledBy, placeholder, onChange, onCommit, className, autoFocus, members,
}: RichTextFieldProps) {
  // Loading normalises Markdown (a single newline becomes a hard break), so "changed" is
  // judged against what the editor produced on load, never against the stored string —
  // otherwise opening an old task and tabbing away would rewrite its description.
  const baseline = useRef<string | null>(null);
  const membersRef = useRef(members ?? []);
  useEffect(() => {
    membersRef.current = members ?? [];
  });
  const hasMembers = members !== undefined;
  // Built once per field: EditorProvider rebuilds the editor when its extensions change.
  const extensions = useMemo(
    // The @ menu reads the ref on keystrokes, never during render.
    // eslint-disable-next-line react-hooks/refs
    () => (hasMembers ? [createMentionExtension(() => membersRef.current)] : undefined),
    [hasMembers],
  );

  return (
    <EditorProvider
      placeholder={placeholder}
      extensions={extensions}
      className={cn(
        'rounded-10 bg-bg-white-0 px-3 py-2 ring-1 ring-inset ring-stroke-soft-200 transition-shadow duration-150 focus-within:ring-stroke-strong-950',
        className,
      )}
      editorProps={{
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          ...(label ? { 'aria-label': label } : {}),
          ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
          class: 'md-content min-h-20 outline-none',
        },
      }}
      onCreate={({ editor }) => {
        loadMarkdown(editor, value);
        baseline.current = readMarkdown(editor);
        // Here rather than Tiptap's autofocus option, which runs before the content loads.
        if (autoFocus) editor.commands.focus('end');
      }}
      onUpdate={({ editor }) => onChange?.(readMarkdown(editor))}
      onBlur={({ editor }) => {
        const markdown = readMarkdown(editor);
        if (markdown === baseline.current) return;
        baseline.current = markdown;
        onCommit?.(markdown);
      }}
    >
      <EditorBubbleMenu>
        <EditorFormatBold />
        <EditorFormatItalic />
        <EditorFormatStrike />
        <EditorFormatCode />
        <EditorLinkControl />
      </EditorBubbleMenu>
    </EditorProvider>
  );
}
