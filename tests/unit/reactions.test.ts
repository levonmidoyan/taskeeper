import { describe, expect, it } from 'vitest';
import { applyToggle, groupReactions, reactorsLabel, type CommentReaction } from '@/lib/reactions';

const row = (commentId: string, emoji: string, userId: string, name: string) => ({ commentId, emoji, userId, name });

describe('groupReactions', () => {
  it('groups per comment in emoji-set order, counting people in reaction order', () => {
    const map = groupReactions([
      row('c1', '🚀', 'u2', 'Bob'),
      row('c1', '👍', 'u2', 'Bob'),
      row('c1', '👍', 'u1', 'Ada'),
      row('c2', '🎉', 'u3', 'Cy'),
    ], 'u1');
    expect(map.get('c1')).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u2', 'u1'], names: ['Bob', 'Ada'] },
      { emoji: '🚀', count: 1, reactedByMe: false, userIds: ['u2'], names: ['Bob'] },
    ]);
    expect(map.get('c2')).toEqual([{ emoji: '🎉', count: 1, reactedByMe: false, userIds: ['u3'], names: ['Cy'] }]);
  });

  it('drops emoji this build does not know', () => {
    expect(groupReactions([row('c1', '💩', 'u1', 'Ada')], 'u1').get('c1')).toBeUndefined();
  });
});

describe('applyToggle', () => {
  const thumbs: CommentReaction = { emoji: '👍', count: 1, reactedByMe: false, userIds: ['u2'], names: ['Bob'] };

  it('adds me to an existing chip', () => {
    expect(applyToggle([thumbs], '👍', 'u1')).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true, userIds: ['u2', 'u1'], names: ['Bob', 'You'] },
    ]);
  });

  it('creates a chip in emoji-set order', () => {
    expect(applyToggle([thumbs], '🚀', 'u1').map((r) => r.emoji)).toEqual(['👍', '🚀']);
    expect(applyToggle([{ ...thumbs, emoji: '🚀' }], '👍', 'u1').map((r) => r.emoji)).toEqual(['👍', '🚀']);
  });

  it('removes me, and the chip at zero', () => {
    const mine: CommentReaction = { emoji: '👍', count: 1, reactedByMe: true, userIds: ['u1'], names: ['Ada'] };
    expect(applyToggle([mine], '👍', 'u1')).toEqual([]);
  });

  // Review Focus 1: each click toggles relative to the last optimistic state.
  it('composes: two toggles of the same emoji cancel out', () => {
    expect(applyToggle(applyToggle([thumbs], '👍', 'u1'), '👍', 'u1')).toEqual([thumbs]);
  });
});

describe('reactorsLabel', () => {
  const r = (userIds: string[], names: string[]): CommentReaction =>
    ({ emoji: '👍', count: userIds.length, reactedByMe: userIds.includes('me'), userIds, names });

  it('names up to two, then counts the rest, calling me You', () => {
    expect(reactorsLabel(r(['a'], ['Ana']), 'me')).toBe('Ana');
    expect(reactorsLabel(r(['a', 'me'], ['Ana', 'Lev']), 'me')).toBe('Ana and You');
    expect(reactorsLabel(r(['a', 'b', 'c'], ['Ana', 'Ben', 'Cy']), 'me')).toBe('Ana, Ben and 1 other');
    expect(reactorsLabel(r(['a', 'b', 'c', 'd'], ['Ana', 'Ben', 'Cy', 'Di']), 'me')).toBe('Ana, Ben and 2 others');
  });
});
