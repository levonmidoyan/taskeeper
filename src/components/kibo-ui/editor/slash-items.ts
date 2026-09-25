import type { Editor, Range } from '@tiptap/core';
import {
  IconH1, IconH2, IconH3, IconList, IconListCheck, IconListNumbers, IconQuote,
  IconSourceCode, IconTypography, type TablerIcon,
} from '@tabler/icons-react';

export type SlashItem = {
  title: string;
  description: string;
  searchTerms: string[];
  icon: TablerIcon;
  command: (props: { editor: Editor; range: Range }) => void;
};

/** Kibo's default slash suggestions, minus Table (no Markdown form in our set). */
export const slashItems: SlashItem[] = [
  {
    title: 'Text', description: 'Just start typing with plain text.', searchTerms: ['p', 'paragraph'],
    icon: IconTypography,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'To-do list', description: 'Track tasks with a to-do list.',
    searchTerms: ['todo', 'task', 'check', 'checkbox'], icon: IconListCheck,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Heading 1', description: 'Big section heading.', searchTerms: ['title', 'big', 'large'],
    icon: IconH1,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2', description: 'Medium section heading.', searchTerms: ['subtitle', 'medium'],
    icon: IconH2,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3', description: 'Small section heading.', searchTerms: ['subtitle', 'small'],
    icon: IconH3,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list', description: 'Create a simple bullet list.', searchTerms: ['unordered', 'point'],
    icon: IconList,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list', description: 'Create a list with numbering.', searchTerms: ['ordered'],
    icon: IconListNumbers,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Quote', description: 'Capture a quote.', searchTerms: ['blockquote'], icon: IconQuote,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().toggleBlockquote().run(),
  },
  {
    title: 'Code block', description: 'Capture a code snippet.', searchTerms: ['codeblock', 'pre'],
    icon: IconSourceCode,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

/** Kibo used Fuse.js over these nine items; a substring match is enough (spec §6.1). */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return slashItems;
  return slashItems.filter(
    (item) => item.title.toLowerCase().includes(q) || item.searchTerms.some((t) => t.includes(q)),
  );
}
