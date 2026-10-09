// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectNavItems, focusedNavId, focusNavItem, navTarget, type NavItem } from '@/lib/shortcuts/nav';

const item = (id: string, col: string | null, top: number, height = 40): NavItem => ({ id, col, top, bottom: top + height });

describe('navTarget — list (no columns)', () => {
  const rows = [item('a', null, 0), item('b', null, 50), item('c', null, 100)];

  it('steps forward and back in order', () => {
    expect(navTarget(rows, 'a', 'next')).toBe('b');
    expect(navTarget(rows, 'c', 'prev')).toBe('b');
  });

  it('stops at either end', () => {
    expect(navTarget(rows, 'c', 'next')).toBeNull();
    expect(navTarget(rows, 'a', 'prev')).toBeNull();
  });

  it('has no columns to the side', () => {
    expect(navTarget(rows, 'b', 'left')).toBeNull();
    expect(navTarget(rows, 'b', 'right')).toBeNull();
  });

  it('returns null for a task not in the view (subtask, filtered out)', () => {
    expect(navTarget(rows, 'zzz', 'next')).toBeNull();
  });
});

describe('navTarget — board', () => {
  // todo: a(0) b(50) c(100) | doing: (empty) | done: x(0) y(80)
  const board = [
    item('a', 'todo', 0), item('b', 'todo', 50), item('c', 'todo', 100),
    item('x', 'done', 0), item('y', 'done', 80),
  ];
  const withEmpty = [...board.slice(0, 3), ...board.slice(3)];

  it('moves within the column only', () => {
    expect(navTarget(board, 'c', 'next')).toBeNull();
    expect(navTarget(board, 'x', 'prev')).toBeNull();
    expect(navTarget(board, 'a', 'next')).toBe('b');
  });

  it('jumps to the nearest card by vertical centre in the next non-empty column', () => {
    expect(navTarget(withEmpty, 'c', 'right')).toBe('y');
    expect(navTarget(withEmpty, 'a', 'right')).toBe('x');
    expect(navTarget(withEmpty, 'y', 'left')).toBe('c');
  });

  it('stops at the outer columns', () => {
    expect(navTarget(board, 'a', 'left')).toBeNull();
    expect(navTarget(board, 'x', 'right')).toBeNull();
  });
});

describe('DOM helpers', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('collects stops in DOM order, skipping anything inside the task detail', () => {
    document.body.innerHTML = `
      <button data-task-nav="a" data-nav-col="todo"></button>
      <a href="#" data-task-nav="b"></a>
      <div data-shortcut-scope="detail"><button data-task-nav="sub"></button></div>`;
    expect(collectNavItems().map((i) => [i.id, i.col])).toEqual([['a', 'todo'], ['b', null]]);
  });

  it('reads and moves focus', () => {
    document.body.innerHTML = '<button data-task-nav="a"><span id="inner"></span></button><button data-task-nav="b"></button>';
    expect(focusedNavId()).toBeNull();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(focusNavItem('b')).toBe(true);
    expect(focusedNavId()).toBe('b');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(focusNavItem('missing')).toBe(false);
  });
});

describe('arrow keys with nothing focused', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('leave the page to scroll; j still lands on the first task', async () => {
    const { createDispatcher } = await import('@/lib/shortcuts/dispatcher');
    const { moveNavCursor } = await import('@/components/shell/TaskNavShortcuts');
    document.body.innerHTML = '<button data-task-nav="a"></button><button data-task-nav="b"></button>';
    Element.prototype.scrollIntoView = () => {};
    const d = createDispatcher({ isMac: () => false });
    d.bind('nav.next', (e) => moveNavCursor('next', e));
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    d.handle(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    expect(focusedNavId()).toBeNull();
    d.handle(new KeyboardEvent('keydown', { key: 'j', cancelable: true }));
    expect(focusedNavId()).toBe('a');
  });
});
