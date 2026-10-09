/**
 * Comment reactions: the fixed emoji set and pure helpers shared by the server,
 * the feed and the UI.
 */

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '👀', '🚀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}
