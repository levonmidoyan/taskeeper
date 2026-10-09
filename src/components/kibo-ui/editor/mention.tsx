'use client';

/**
 * @mentions — @tiptap/extension-mention with its Markdown hooks replaced: it writes a shortcode
 * (`[@ id="…" label="…"]`) out of the box; ours is a link, `[@Name](mention:<id>)`
 * (src/lib/mentions.ts), which reads as "@Name" anywhere the editor is absent. The popup copies
 * the slash menu (slash.tsx): cmdk with the editor keeping focus, keys forwarded, mounted inside
 * the surrounding dialog.
 */

import type { AnyExtension } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import { Command } from 'cmdk';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { UserAvatar } from '@/components/auth/user/user-avatar';
import { filterMembers, MENTION_LINK_SOURCE, mentionMarkdown, unescapeMentionLabel } from '@/lib/mentions';

export type MentionMember = { userId: string; name: string; email: string; image: string | null };

type MenuProps = { items: MentionMember[]; command: (attrs: { id: string; label: string }) => void };

function MentionMenu({ items, command }: MenuProps) {
  return (
    <Command
      // Remount on a new item set: cmdk would otherwise keep a highlight on a filtered-out value.
      key={items.map((m) => m.userId).join('|')}
      id="mention-menu"
      label="Mention someone"
      shouldFilter={false}
      onKeyDown={(event) => event.stopPropagation()}
      className="w-64 overflow-hidden rounded-2xl bg-bg-white-0 p-1.5 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200"
    >
      <Command.List>
        {items.map((m) => (
          <Command.Item
            key={m.userId}
            value={m.userId}
            onSelect={() => command({ id: m.userId, label: m.name })}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 data-[selected=true]:bg-bg-weak-50"
          >
            <UserAvatar user={{ name: m.name, image: m.image }} aria-hidden="true" className="size-6 text-[0.625rem]" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label-sm text-text-strong-950">{m.name}</span>
              <span className="truncate text-paragraph-xs text-text-sub-600">{m.email}</span>
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
  const menu = document.querySelector('#mention-menu');
  if (!menu) return false;
  event.preventDefault();
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, cancelable: true, bubbles: true }));
  return true;
}

export const mentionPluginKey = new PluginKey('mention');

const LINK_AT_START = new RegExp(`^${MENTION_LINK_SOURCE}`);
const LINK_ANYWHERE = new RegExp(MENTION_LINK_SOURCE);

/** `getMembers` is read on every keystroke, so a changed member list needs no editor rebuild. */
export function createMentionExtension(getMembers: () => MentionMember[]): AnyExtension {
  return Mention.extend({
    markdownTokenizer: {
      name: 'mention',
      level: 'inline',
      start: (src: string) => src.search(LINK_ANYWHERE),
      tokenize(src: string) {
        const match = src.match(LINK_AT_START);
        if (!match) return undefined;
        return { type: 'mention', raw: match[0], attributes: { label: unescapeMentionLabel(match[1]), id: match[2] } };
      },
    },
    parseMarkdown: (token, helpers) => helpers.createNode('mention', token.attributes),
    renderMarkdown: (node) => mentionMarkdown(String(node.attrs?.id ?? ''), String(node.attrs?.label ?? '')),
  }).configure({
    HTMLAttributes: { class: 'mention' },
    // The chip goes whole; by default Backspace leaves "@" behind and reopens the menu.
    deleteTriggerWithBackspace: true,
    renderText: ({ node }) => `@${node.attrs.label}`,
    renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, `@${node.attrs.label}`],
    suggestion: {
      char: '@',
      pluginKey: mentionPluginKey,
      items: ({ query }) => filterMembers(getMembers(), query),
      render: () => {
        let component: ReactRenderer<unknown, MenuProps> | undefined;
        let popup: TippyInstance | undefined;
        // No match (an email address, "@ 5pm"): the menu steps aside and keys stay the editor's.
        let hasItems = false;
        return {
          onStart: (props) => {
            hasItems = props.items.length > 0;
            component = new ReactRenderer(MentionMenu, { props, editor: props.editor });
            popup = tippy(document.body, {
              getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
              appendTo: () => props.editor.view.dom.closest('[role="dialog"]') ?? document.body,
              content: component.element,
              showOnCreate: hasItems,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            });
          },
          onUpdate: (props) => {
            hasItems = props.items.length > 0;
            component?.updateProps(props);
            popup?.setProps({ getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect() });
            if (hasItems) popup?.show();
            else popup?.hide();
          },
          onKeyDown: ({ event }) => {
            if (event.key === 'Escape') {
              popup?.hide();
              return true;
            }
            return hasItems && forwardToMenu(event);
          },
          onExit: () => {
            popup?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}
