import { describe, expect, it } from 'vitest';
import { applyTodoOp, dropTarget } from '@/lib/todo-list';
import type { TodoLists, TodoRow } from '@/server/todos/queries';

const row = (id: string, completedAt: Date | null = null): TodoRow =>
  ({ id, title: id.toUpperCase(), dueDate: null, completedAt });

const lists = (open: string[], done: string[] = []): TodoLists => ({
  open: open.map((id) => row(id)),
  done: done.map((id) => row(id, new Date('2026-09-01T00:00:00Z'))),
});

const ids = (l: TodoLists) => ({ open: l.open.map((t) => t.id), done: l.done.map((t) => t.id) });
const now = new Date('2026-09-28T10:00:00Z');

describe('applyTodoOp', () => {
  it('checking moves the item to the top of done', () => {
    const next = applyTodoOp(lists(['a', 'b'], ['z']), { kind: 'toggle', id: 'a', done: true, now });
    expect(ids(next)).toEqual({ open: ['b'], done: ['a', 'z'] });
    expect(next.done[0].completedAt).toEqual(now);
  });

  it('unchecking moves the item to the end of open', () => {
    const next = applyTodoOp(lists(['a'], ['z', 'y']), { kind: 'toggle', id: 'y', done: false, now });
    expect(ids(next)).toEqual({ open: ['a', 'y'], done: ['z'] });
    expect(next.open[1].completedAt).toBeNull();
  });

  it('toggling twice quickly never duplicates the item', () => {
    let l = lists(['a', 'b']);
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: true, now });
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: false, now });
    l = applyTodoOp(l, { kind: 'toggle', id: 'a', done: true, now });
    expect(ids(l)).toEqual({ open: ['b'], done: ['a'] });
  });

  it('a toggle that is already applied is a no-op', () => {
    const start = lists(['a'], ['z']);
    expect(applyTodoOp(start, { kind: 'toggle', id: 'z', done: true, now })).toBe(start);
    expect(applyTodoOp(start, { kind: 'toggle', id: 'a', done: false, now })).toBe(start);
  });

  it('moves an open item to an index', () => {
    const next = applyTodoOp(lists(['a', 'b', 'c']), { kind: 'move', id: 'c', toIndex: 0 });
    expect(ids(next).open).toEqual(['c', 'a', 'b']);
  });

  it('edits title and due date in either list', () => {
    let l = lists(['a'], ['z']);
    l = applyTodoOp(l, { kind: 'edit', id: 'a', title: 'New' });
    l = applyTodoOp(l, { kind: 'edit', id: 'z', dueDate: '2026-10-01' });
    expect(l.open[0].title).toBe('New');
    expect(l.done[0].dueDate).toBe('2026-10-01');
  });

  it('deletes from either list', () => {
    const next = applyTodoOp(
      applyTodoOp(lists(['a', 'b'], ['z']), { kind: 'delete', id: 'a' }),
      { kind: 'delete', id: 'z' },
    );
    expect(ids(next)).toEqual({ open: ['b'], done: [] });
  });
});

describe('dropTarget', () => {
  it('moving down lands after the item dropped on', () => {
    expect(dropTarget(['a', 'b', 'c'], 'a', 'b')).toEqual({ toIndex: 1, beforeId: 'b', afterId: 'c' });
  });

  it('moving up lands before the item dropped on', () => {
    expect(dropTarget(['a', 'b', 'c'], 'c', 'a')).toEqual({ toIndex: 0, beforeId: null, afterId: 'a' });
  });

  it('moving to the end has no after neighbour', () => {
    expect(dropTarget(['a', 'b', 'c'], 'a', 'c')).toEqual({ toIndex: 2, beforeId: 'c', afterId: null });
  });

  it('dropping on itself or an unknown id is no move', () => {
    expect(dropTarget(['a', 'b'], 'a', 'a')).toBeNull();
    expect(dropTarget(['a', 'b'], 'a', 'zzz')).toBeNull();
  });
});
