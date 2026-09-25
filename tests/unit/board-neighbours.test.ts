import { describe, expect, it } from 'vitest';
import {
  columnId, isUnchanged, neighboursAfterMove, statusIdOf,
} from '@/components/board/neighbours';

const todo = columnId('todo');
const doing = columnId('doing');
const item = (id: string, column: string) => ({ id, column });

// Kibo keeps one flat array; order within a column is the order of its items.
const board = [item('a', todo), item('b', todo), item('c', todo), item('x', doing), item('y', doing)];

describe('column ids', () => {
  it('prefix and strip status:', () => {
    // The prefix is part of the e2e contract (dnd-kit announces "droppable area status:…").
    expect(columnId('abc')).toBe('status:abc');
    expect(statusIdOf('status:abc')).toBe('abc');
  });
});

describe('neighboursAfterMove', () => {
  it('reads the neighbours of a card moved up within its column', () => {
    const after = [item('a', todo), item('c', todo), item('b', todo), item('x', doing), item('y', doing)];
    expect(neighboursAfterMove(after, 'c')).toEqual({
      statusId: 'todo', beforeId: 'a', afterId: 'b', index: 1, columnSize: 3,
    });
  });

  it('handles the top and bottom of a column', () => {
    expect(neighboursAfterMove(board, 'a')).toMatchObject({ beforeId: null, afterId: 'b', index: 0 });
    expect(neighboursAfterMove(board, 'c')).toMatchObject({ beforeId: 'b', afterId: null, index: 2 });
  });

  it('handles a card moved into the middle of another column', () => {
    const after = [item('a', todo), item('c', todo), item('x', doing), item('b', doing), item('y', doing)];
    expect(neighboursAfterMove(after, 'b')).toEqual({
      statusId: 'doing', beforeId: 'x', afterId: 'y', index: 1, columnSize: 3,
    });
  });

  it('handles a card moved into an empty column', () => {
    const after = [item('a', todo), item('b', columnId('done'))];
    expect(neighboursAfterMove(after, 'b')).toEqual({
      statusId: 'done', beforeId: null, afterId: null, index: 0, columnSize: 1,
    });
  });

  it('returns null for an unknown card', () => {
    expect(neighboursAfterMove(board, 'nope')).toBeNull();
  });
});

describe('isUnchanged', () => {
  it('is true when the card ends where it started', () => {
    expect(isUnchanged(board, [...board], 'b')).toBe(true);
  });

  it('is false for a reorder or a column change', () => {
    const reordered = [item('b', todo), item('a', todo), item('c', todo), item('x', doing), item('y', doing)];
    expect(isUnchanged(board, reordered, 'b')).toBe(false);
    const moved = [item('a', todo), item('c', todo), item('x', doing), item('y', doing), item('b', doing)];
    expect(isUnchanged(board, moved, 'b')).toBe(false);
  });

  it('ignores reorders elsewhere on the board', () => {
    const others = [item('a', todo), item('b', todo), item('c', todo), item('y', doing), item('x', doing)];
    expect(isUnchanged(board, others, 'b')).toBe(true);
  });
});
