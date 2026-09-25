'use client';

/**
 * Slash menu — adapted from Kibo UI's editor (haydenbleasel/kibo@3d63cdb, packages/editor):
 * a plain Extension + Suggestion instead of Kibo's inline "slash" Node (that node has no
 * Markdown form and is never kept in the document anyway); cmdk directly with Align styling
 * instead of shadcn's Command wrapper; arrow/enter navigation forwarded once (Kibo forwarded
 * from both editorProps and the suggestion, which moved the highlight twice); the popup is
 * mounted inside the surrounding dialog, if any, since a modal dialog makes everything outside
 * it inert to the pointer and treats clicks there as dismissals.
 */

import { type Editor, Extension, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { Command } from 'cmdk';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { filterSlashItems, type SlashItem } from '@/components/kibo-ui/editor/slash-items';

type SlashMenuProps = { items: SlashItem[]; editor: Editor; range: Range };

function SlashMenu({ items, editor, range }: SlashMenuProps) {
  return (
    <Command
      id="slash-command"
      label="Insert block"
      shouldFilter={false}
      onKeyDown={(event) => event.stopPropagation()}
      className="w-72 overflow-hidden rounded-2xl bg-bg-white-0 p-2 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200"
    >
      <Command.List>
        <Command.Empty className="p-3 text-paragraph-sm text-text-sub-600">No results</Command.Empty>
        {items.map((item) => (
          <Command.Item
            key={item.title}
            value={item.title}
            onSelect={() => item.command({ editor, range })}
            className="flex cursor-pointer items-center gap-3 rounded-lg p-2 data-[selected=true]:bg-bg-weak-50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200">
              <item.icon className="size-4 text-text-sub-600" aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className="text-label-sm text-text-strong-950">{item.title}</span>
              <span className="text-paragraph-xs text-text-sub-600">{item.description}</span>
            </span>
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}

/** cmdk owns arrow/enter handling; the editor keeps focus, so forward the keys to it. */
function forwardToMenu(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return false;
  const menu = document.querySelector('#slash-command');
  if (!menu) return false;
  event.preventDefault();
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, cancelable: true, bubbles: true }));
  return true;
}

export const slashPluginKey = new PluginKey('slashCommand');

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: slashPluginKey,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: () => {
          let component: ReactRenderer<unknown, SlashMenuProps> | undefined;
          let popup: TippyInstance | undefined;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              popup = tippy(document.body, {
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
                appendTo: () => props.editor.view.dom.closest('[role="dialog"]') ?? document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              popup?.setProps({
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
              });
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                popup?.hide();
                return true;
              }
              return forwardToMenu(event);
            },
            onExit: () => {
              popup?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
