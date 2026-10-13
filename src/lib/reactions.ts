/**
 * Comment reactions: the fixed emoji set and pure helpers shared by the server,
 * the feed and the UI.
 */

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '👀', '🚀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

export type CommentReaction = {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
  /** In reaction order; parallel to names. */
  userIds: string[];
  names: string[];
};

const order = (emoji: ReactionEmoji) => REACTION_EMOJIS.indexOf(emoji);
const byEmoji = (a: CommentReaction, b: CommentReaction) => order(a.emoji) - order(b.emoji);

/** Reaction rows (oldest first) into each comment's chips, in emoji-set order. */
export function groupReactions(
  rows: { commentId: string; emoji: string; userId: string; name: string }[],
  currentUserId: string,
): Map<string, CommentReaction[]> {
  const byComment = new Map<string, Map<ReactionEmoji, CommentReaction>>();
  for (const r of rows) {
    // A kind written by another deploy that this build does not know is dropped.
    if (!isReactionEmoji(r.emoji)) continue;
    const chips = byComment.get(r.commentId) ?? new Map<ReactionEmoji, CommentReaction>();
    byComment.set(r.commentId, chips);
    const chip = chips.get(r.emoji) ?? { emoji: r.emoji, count: 0, reactedByMe: false, userIds: [], names: [] };
    chips.set(r.emoji, chip);
    chip.count += 1;
    chip.userIds.push(r.userId);
    chip.names.push(r.name);
    if (r.userId === currentUserId) chip.reactedByMe = true;
  }
  return new Map([...byComment].map(([id, chips]) => [id, [...chips.values()].sort(byEmoji)]));
}

/** The chips after I toggle `emoji`: the optimistic step, so it must compose. */
export function applyToggle(
  reactions: CommentReaction[],
  emoji: ReactionEmoji,
  currentUserId: string,
): CommentReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) {
    return [...reactions, { emoji, count: 1, reactedByMe: true, userIds: [currentUserId], names: ['You'] }].sort(byEmoji);
  }
  if (existing.reactedByMe) {
    const keep = existing.userIds.map((id, i) => id !== currentUserId ? i : -1).filter((i) => i >= 0);
    if (keep.length === 0) return reactions.filter((r) => r !== existing);
    const next: CommentReaction = {
      emoji, count: keep.length, reactedByMe: false,
      userIds: keep.map((i) => existing.userIds[i]), names: keep.map((i) => existing.names[i]),
    };
    return reactions.map((r) => (r === existing ? next : r));
  }
  const next: CommentReaction = {
    emoji, count: existing.count + 1, reactedByMe: true,
    userIds: [...existing.userIds, currentUserId], names: [...existing.names, 'You'],
  };
  return reactions.map((r) => (r === existing ? next : r));
}

/** Tooltip text: "Ana", "Ana and You", "Ana, Ben and 2 others". */
export function reactorsLabel(reaction: CommentReaction, currentUserId: string): string {
  const names = reaction.names.map((name, i) => (reaction.userIds[i] === currentUserId ? 'You' : name));
  if (names.length <= 2) return names.join(' and ');
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}
