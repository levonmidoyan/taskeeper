/**
 * @mentions live in Markdown as `[@Display Name](mention:<userId>)`. The display name is the
 * member's name when mentioned: readers without the member list (REST API, ex-members) see it.
 * Shared by the editor (src/components/kibo-ui/editor/mention.tsx), the renderer
 * (src/components/task/Markdown.tsx) and the server (src/server/notifications/changes.ts).
 */

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export const MENTION_SCHEME = 'mention:';

const ID_CHARS = '[A-Za-z0-9_-]+';

/** Two groups: the escaped label and the id. No anchors and no flags, so callers add their own. */
export const MENTION_LINK_SOURCE = String.raw`\[@((?:\\.|[^\]\\])*)\]\(mention:(${ID_CHARS})\)`;

const MENTION_ID = new RegExp(`^${ID_CHARS}$`);

/**
 * The member a parsed link mentions: a mention: link to a well-formed id, labelled "@…".
 * The one rule both for who is notified and for what renders as a chip.
 */
export function mentionTarget(url: string | null | undefined, label: string): string | null {
  if (!url?.startsWith(MENTION_SCHEME) || !label.startsWith('@')) return null;
  const id = url.slice(MENTION_SCHEME.length);
  return MENTION_ID.test(id) ? id : null;
}

export function escapeMentionLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1');
}

export function unescapeMentionLabel(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

export function mentionMarkdown(id: string, label: string): string {
  return `[@${escapeMentionLabel(label)}](${MENTION_SCHEME}${id})`;
}

type MdNode = { type: string; url?: string; value?: string; identifier?: string; children?: MdNode[] };

// Parsed as the renderer parses (src/components/task/Markdown.tsx), so code, escapes and
// reference links count the same here as on screen.
const parser = unified().use(remarkParse).use(remarkGfm);

/** The text under an mdast or hast node: both keep it in `value` leaves. */
export const nodeText = (node: { value?: unknown; children?: unknown[] }): string =>
  typeof node.value === 'string' ? node.value : (node.children ?? []).map((c) => nodeText(c as typeof node)).join('');

function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

/** Ids of the members `markdown` mentions, in order of first mention. */
export function extractMentionIds(markdown: string): string[] {
  const tree = parser.parse(markdown) as MdNode;
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url ?? '');
    }
  });
  const ids = new Set<string>();
  walk(tree, (node) => {
    const url = node.type === 'link' ? node.url
      : node.type === 'linkReference' && node.identifier ? definitions.get(node.identifier)
        : undefined;
    const id = url === undefined ? null : mentionTarget(url, nodeText(node));
    if (id) ids.add(id);
  });
  return [...ids];
}

export function mentionsToText(markdown: string): string {
  return markdown.replace(new RegExp(MENTION_LINK_SOURCE, 'g'), (_, label: string) => `@${unescapeMentionLabel(label)}`);
}

export function filterMembers<T extends { name: string; email: string }>(members: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    .slice(0, limit);
}
