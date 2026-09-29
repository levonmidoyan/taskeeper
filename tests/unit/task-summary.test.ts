import { describe, expect, it } from 'vitest';
import { addDays, summarizeTasks } from '@/lib/task-summary';
import type { StatusRow } from '@/server/projects/queries';
import type { Priority, TaskRow } from '@/server/tasks/queries';

const YEREVAN = 'Asia/Yerevan';

const statuses: StatusRow[] = [
  { id: 'todo', name: 'Todo', color: 'muted', position: 'a0', isDone: false, icon: null },
  { id: 'doing', name: 'In Progress', color: 'primary', position: 'a1', isDone: false, icon: null },
  { id: 'done', name: 'Done', color: 'success', position: 'a2', isDone: true, icon: null },
];

function task(overrides: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    title: overrides.id, description: '', statusId: 'todo', priority: 'none' as Priority,
    assigneeId: null, assigneeName: null, assigneeImage: null, dueDate: null, position: 'a0', completedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
    labels: [], subtaskCount: 0, subtaskDoneCount: 0, ...overrides,
  };
}

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('summarizeTasks', () => {
  // 2026-09-28T10:00Z is 14:00 on the 28th in Yerevan.
  const now = new Date('2026-09-28T10:00:00Z');

  it('counts open, done, overdue and due-soon', () => {
    const tasks = [
      task({ id: 'late', dueDate: '2026-09-27' }),
      task({ id: 'today', dueDate: '2026-09-28' }),
      task({ id: 'day6', dueDate: '2026-10-04' }),
      task({ id: 'day7', dueDate: '2026-10-05' }),
      task({ id: 'nodate' }),
      task({ id: 'doneLate', statusId: 'done', dueDate: '2026-09-01', completedAt: new Date() }),
    ];
    const s = summarizeTasks(tasks, statuses, YEREVAN, now);
    expect(s).toMatchObject({ total: 6, open: 5, done: 1, overdue: 1, dueSoon: 2 });
  });

  it('judges overdue by the workspace day, not the UTC day', () => {
    // 21:00 UTC on the 27th is already 01:00 on the 28th in Yerevan, so a task
    // due on the 27th is overdue there even though UTC is still on the 27th.
    const lateEvening = new Date('2026-09-27T21:00:00Z');
    const s = summarizeTasks([task({ id: 't', dueDate: '2026-09-27' })], statuses, YEREVAN, lateEvening);
    expect(s.overdue).toBe(1);
    expect(summarizeTasks([task({ id: 't', dueDate: '2026-09-27' })], statuses, 'UTC', lateEvening).overdue)
      .toBe(0);
  });

  it('lists every status in column order, empty ones included', () => {
    const s = summarizeTasks([task({ id: 'a', statusId: 'doing' })], statuses, YEREVAN, now);
    expect(s.byStatus.map((r) => [r.status.id, r.count])).toEqual([
      ['todo', 0], ['doing', 1], ['done', 0],
    ]);
  });

  it('lists priorities most urgent first', () => {
    const s = summarizeTasks(
      [task({ id: 'a', priority: 'high' }), task({ id: 'b', priority: 'high' }), task({ id: 'c' })],
      statuses, YEREVAN, now,
    );
    expect(s.byPriority).toEqual([
      { priority: 'urgent', count: 0 },
      { priority: 'high', count: 2 },
      { priority: 'medium', count: 0 },
      { priority: 'low', count: 0 },
      { priority: 'none', count: 1 },
    ]);
  });
});
