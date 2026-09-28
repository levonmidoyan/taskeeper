import { describe, expect, it } from 'vitest';
import {
  PRIORITY_RANK,
  boardOrder,
  compareKeys,
  formatSortParam,
  parseSortParam,
} from '@/lib/task-table-sort';
import type { StatusRow } from '@/server/projects/queries';
import type { TaskRow } from '@/server/tasks/queries';

const statuses: StatusRow[] = [
  { id: 'done', name: 'Done', color: 'success', position: 'a2', isDone: true, icon: null },
  { id: 'todo', name: 'Todo', color: 'muted', position: 'a0', isDone: false, icon: null },
  { id: 'doing', name: 'In Progress', color: 'primary', position: 'a1', isDone: false, icon: null },
];

function task(id: string, statusId: string, position: string): TaskRow {
  return {
    id, title: id, description: '', statusId, priority: 'none', assigneeId: null,
    assigneeName: null, assigneeImage: null, dueDate: null, position, completedAt: null, labels: [],
    subtaskCount: 0, subtaskDoneCount: 0,
  };
}

describe('boardOrder', () => {
  it('orders by column position, then by card position within a column', () => {
    const tasks = [
      task('d1', 'done', 'a0'),
      task('t2', 'todo', 'a1'),
      task('p1', 'doing', 'a0'),
      task('t1', 'todo', 'a0'),
    ];
    expect(boardOrder(tasks, statuses).map((t) => t.id)).toEqual(['t1', 't2', 'p1', 'd1']);
  });

  it('does not mutate its input', () => {
    const tasks = [task('d1', 'done', 'a0'), task('t1', 'todo', 'a0')];
    boardOrder(tasks, statuses);
    expect(tasks.map((t) => t.id)).toEqual(['d1', 't1']);
  });
});

describe('compareKeys', () => {
  it('orders fractional-index keys by code unit, not locale', () => {
    // localeCompare would put lowercase "a" before uppercase "Z"; the keys need "Z" first.
    expect(compareKeys('Zz', 'a0')).toBeLessThan(0);
    expect(compareKeys('a0', 'a0')).toBe(0);
    expect(compareKeys('a1', 'a0')).toBeGreaterThan(0);
  });
});

describe('PRIORITY_RANK', () => {
  it('ranks urgent first and no priority last', () => {
    const order = (Object.keys(PRIORITY_RANK) as (keyof typeof PRIORITY_RANK)[])
      .sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b]);
    expect(order).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
  });
});

describe('sort param', () => {
  it('parses a column and direction', () => {
    expect(parseSortParam('due.asc')).toEqual([{ id: 'due', desc: false }]);
    expect(parseSortParam('priority.desc')).toEqual([{ id: 'priority', desc: true }]);
  });

  it('treats missing, unknown or malformed values as no sort', () => {
    expect(parseSortParam(null)).toEqual([]);
    expect(parseSortParam('')).toEqual([]);
    expect(parseSortParam('labels.asc')).toEqual([]);
    expect(parseSortParam('due.sideways')).toEqual([]);
    expect(parseSortParam('due')).toEqual([]);
  });

  it('round-trips through formatSortParam', () => {
    expect(formatSortParam(parseSortParam('title.desc'))).toBe('title.desc');
    expect(formatSortParam([])).toBeNull();
    expect(formatSortParam([{ id: 'labels', desc: false }])).toBeNull();
  });
});
