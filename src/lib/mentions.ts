/**
 * @mentions live in Markdown as `[@Display Name](mention:<userId>)`. The display name is the
 * member's name when mentioned: readers without the member list (REST API, ex-members) see it.
 * Shared by the editor (src/components/kibo-ui/editor/mention.tsx), the renderer
 * (src/components/task/Markdown.tsx) and the server (src/server/notifications/changes.ts).
 */

export const MENTION_SCHEME = 'mention:';

/** Two groups: the escaped label and the id. No anchors and no flags, so callers add their own. */
export const MENTION_LINK_SOURCE = String.raw`\[@((?:\\.|[^\]\\])*)\]\(mention:([A-Za-z0-9_-]+)\)`;

export function escapeMentionLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1');
}

export function unescapeMentionLabel(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

export function mentionMarkdown(id: string, label: string): string {
  return `[@${escapeMentionLabel(label)}](${MENTION_SCHEME}${id})`;
}

/** Code is not prose: a mention-shaped string inside it is text, not a mention. */
function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

export function extractMentionIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of withoutCode(markdown).matchAll(new RegExp(MENTION_LINK_SOURCE, 'g'))) ids.add(match[2]);
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
