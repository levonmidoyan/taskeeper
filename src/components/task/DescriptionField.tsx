'use client';

import { IconPencil } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { CollapsibleSection } from '@/components/task/CollapsibleSection';
import { Markdown } from '@/components/task/Markdown';
import { RichTextField } from '@/components/task/RichTextField';
import * as Button from '@/components/ui/button';
import { useServerValue } from '@/hooks/use-server-value';
import { LOCAL_ESCAPE_EVENT } from '@/lib/local-escape';
import type { MemberRow } from '@/server/labels/queries';

/**
 * The task's description, Jira-style: rendered Markdown until clicked, then the
 * editor with Save and Cancel. Escape cancels, Ctrl/⌘+Enter saves.
 */
export function DescriptionField({
  value: server,
  members,
  currentUserId,
  onSave,
}: {
  value: string;
  /** Offered by the @ menu, and the names mention chips show. */
  members: MemberRow[];
  currentUserId: string;
  /** `revert` puts the shown text back if the server rejects the save. */
  onSave: (markdown: string, revert: () => void) => void;
}) {
  // Shows my saved text straight away, and a teammate's edit once it arrives.
  // While I edit, the editor holds its own copy; theirs shows when I leave it.
  const [value, setValue] = useServerValue(server);
  const [editing, setEditing] = useState(false);
  // Null until the first keystroke: opening and saving untouched must not rewrite
  // the stored text with the editor's normalised Markdown.
  const draft = useRef<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function startEdit() {
    draft.current = null;
    setEditing(true);
  }

  function finish() {
    returnFocus.current = true;
    setEditing(false);
  }

  function save() {
    const next = draft.current;
    finish();
    if (next === null || next === value) return;
    const previous = value;
    setValue(next);
    onSave(next, () => setValue(previous));
  }

  // Inside a dialog, Escape reaches the dialog first; it hands it over by this event.
  useEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return;
    const cancel = () => finish();
    el.addEventListener(LOCAL_ESCAPE_EVENT, cancel);
    return () => el.removeEventListener(LOCAL_ESCAPE_EVENT, cancel);
  }, [editing]);

  // Back to where the edit started, so the keyboard is not dropped on the body.
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editButtonRef.current?.focus();
  }, [editing]);

  const empty = value.trim() === '';

  return (
    <CollapsibleSection
      sectionId="description"
      title="Description"
      actions={!editing && !empty && (
        <Button.Root
          ref={editButtonRef}
          type="button"
          variant="neutral"
          mode="ghost"
          size="xxsmall"
          onClick={startEdit}
        >
          <Button.Icon as={IconPencil} />
          Edit
        </Button.Root>
      )}
    >
      {editing ? (
        <div
          ref={editorRef}
          data-local-escape=""
          className="flex flex-col gap-2"
          onKeyDownCapture={(event) => {
            // Ahead of the editor, whose own Mod-Enter would add a line break first.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.stopPropagation();
              save();
            }
          }}
          onKeyDown={(event) => {
            // Already handled when the slash menu or link field took it.
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              finish();
            }
          }}
        >
          <RichTextField
            value={value}
            label="Description"
            members={members}
            placeholder="Add details… Type / for headings, lists and more."
            autoFocus
            onChange={(markdown) => { draft.current = markdown; }}
          />
          <div className="flex gap-2">
            <Button.Root type="button" size="xxsmall" onClick={save}>Save</Button.Root>
            <Button.Root type="button" variant="neutral" mode="stroke" size="xxsmall" onClick={finish}>
              Cancel
            </Button.Root>
          </div>
        </div>
      ) : empty ? (
        <button
          ref={editButtonRef}
          type="button"
          onClick={startEdit}
          className="rounded-10 px-3 py-2 text-left text-paragraph-sm text-text-soft-400 ring-1 ring-inset ring-stroke-soft-200 transition-colors duration-150 hover:bg-bg-weak-50"
        >
          Add a description…
        </button>
      ) : (
        // A pointer shortcut into the editor; the Edit button is the keyboard's way in.
        <div
          data-testid="description-preview"
          onClick={(event) => {
            if ((event.target as Element).closest('a')) return;
            // Selecting text to copy it is not a request to edit.
            if (window.getSelection()?.toString()) return;
            startEdit();
          }}
          className="-mx-3 cursor-text rounded-10 px-3 py-2 transition-colors duration-150 hover:bg-bg-weak-50"
        >
          <Markdown members={members} currentUserId={currentUserId}>{value}</Markdown>
        </div>
      )}
    </CollapsibleSection>
  );
}
