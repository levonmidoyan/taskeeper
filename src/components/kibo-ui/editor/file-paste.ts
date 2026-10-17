/**
 * Files pasted or dropped into the editor. Each one shows an "Uploading…" widget at the
 * caret (a decoration, so nothing reaches the Markdown while it runs) and becomes an image
 * or a link to the attachment once uploaded; a failed upload just removes the widget.
 */
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { attachmentSrc, inlineLabel, isEmbeddableImage } from '@/lib/inline-attachment';

/** Starts one upload per file; each resolves to the attachment id, or null when it failed. */
export type UploadFiles = (files: File[]) => Promise<string | null>[];

type Meta = { add?: { id: string; pos: number; name: string }; remove?: string };

export const filePastePluginKey = new PluginKey<DecorationSet>('filePaste');

function widget(name: string) {
  const el = document.createElement('span');
  el.className = 'inline-upload';
  el.textContent = `Uploading ${name}…`;
  el.setAttribute('aria-live', 'polite');
  return el;
}

function findPlaceholder(view: EditorView, id: string): number | null {
  const set = filePastePluginKey.getState(view.state);
  const found = set?.find(undefined, undefined, (spec) => spec.id === id);
  return found?.length ? found[0].from : null;
}

export function pendingUploads(editor: Editor): number {
  return filePastePluginKey.getState(editor.state)?.find().length ?? 0;
}

function startUploads(editor: Editor, upload: UploadFiles, files: File[], pos: number, onPendingChange?: (n: number) => void) {
  const { view } = editor;
  const ids = files.map(() => crypto.randomUUID());
  // One transaction per widget: a plugin meta holds one value.
  files.forEach((file, i) => {
    const meta: Meta = { add: { id: ids[i], pos, name: inlineLabel(file.name) } };
    view.dispatch(view.state.tr.setMeta(filePastePluginKey, meta));
  });
  onPendingChange?.(pendingUploads(editor));

  upload(files).forEach((promise, i) => {
    const file = files[i];
    const id = ids[i];
    void promise.catch(() => null).then((attachmentId) => {
      if (editor.isDestroyed) return;
      const at = findPlaceholder(view, id);
      const done = view.state.tr.setMeta(filePastePluginKey, { remove: id } satisfies Meta);
      if (at !== null && attachmentId) {
        const label = inlineLabel(file.name);
        const src = attachmentSrc(attachmentId);
        const { schema } = view.state;
        const node = isEmbeddableImage(file.type)
          ? schema.nodes.image.create({ src, alt: label })
          : schema.text(label, [schema.marks.link.create({ href: src })]);
        // A space after, so typing on does not extend the link or butt against the image.
        // Where neither fits (a code block), the file is still in the Attachments section.
        try {
          done.insert(at, [node, schema.text(' ')]);
        } catch {
          // Left out; the widget still goes.
        }
      }
      view.dispatch(done);
      onPendingChange?.(pendingUploads(editor));
    });
  });
}

export function createFilePasteExtension(getUpload: () => UploadFiles | undefined, onPendingChange?: (n: number) => void) {
  return Extension.create({
    name: 'filePaste',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin<DecorationSet>({
          key: filePastePluginKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
              let next = set.map(tr.mapping, tr.doc);
              const meta = tr.getMeta(filePastePluginKey) as Meta | undefined;
              if (meta?.add) {
                const deco = Decoration.widget(meta.add.pos, widget(meta.add.name), { id: meta.add.id, side: -1 });
                next = next.add(tr.doc, [deco]);
              }
              if (meta?.remove) {
                const id = meta.remove;
                next = next.remove(next.find(undefined, undefined, (spec) => spec.id === id));
              }
              return next;
            },
          },
          props: {
            decorations: (state) => filePastePluginKey.getState(state),
            handlePaste(view, event) {
              const upload = getUpload();
              const files = Array.from(event.clipboardData?.files ?? []);
              if (!upload || !files.length) return false;
              event.preventDefault();
              const { from, to } = view.state.selection;
              if (from !== to) view.dispatch(view.state.tr.deleteSelection());
              startUploads(editor, upload, files, view.state.selection.from, onPendingChange);
              return true;
            },
            handleDrop(view, event, _slice, moved) {
              const upload = getUpload();
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (moved || !upload || !files.length) return false;
              event.preventDefault();
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                ?? view.state.selection.from;
              startUploads(editor, upload, files, pos, onPendingChange);
              return true;
            },
          },
        }),
      ];
    },
  });
}
