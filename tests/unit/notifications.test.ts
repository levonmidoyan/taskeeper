import { describe, expect, it } from 'vitest';
import { bellHref, bellText, pickToasts, type BellItem } from '@/lib/notifications';

const task = (data: object): BellItem => ({
  kind: 'task_change', taskId: 't1', projectId: null,
  data: { title: 'Ship', projectName: 'Web', actorName: 'Anna', changes: ['title'], ...data } as BellItem['data'],
});
const proj = (data: object, projectId: string | null = 'p1'): BellItem => ({
  kind: 'project_change', taskId: null, projectId,
  data: { projectName: 'Website', actorName: 'Anna', changes: ['renamed'], ...data } as BellItem['data'],
});

describe('bellText', () => {
  it('describes task changes', () => {
    expect(bellText(task({ changes: ['status', 'priority', 'due_date'] }))).toEqual({ title: 'Ship', detail: 'Anna changed status, priority, due date' });
    expect(bellText(task({ changes: ['assignee', 'title'], assignedToYou: true })).detail).toBe('Anna assigned you');
    expect(bellText(task({ changes: ['comment'], comment: 'Looks good' })).detail).toBe('Anna commented: “Looks good”');
    expect(bellText(task({ changes: ['status'], status: 'Done' })).detail).toBe('Anna moved to Done');
    expect(bellText(task({ changes: ['attachment', 'labels'] })).detail).toBe('Anna changed attachments, labels');
  });

  it('describes project changes', () => {
    expect(bellText(proj({ newName: 'Site v2' }))).toEqual({ title: 'Website', detail: 'Anna renamed to Site v2' });
    expect(bellText(proj({ changes: ['archived'] })).detail).toBe('Anna archived this project');
    expect(bellText(proj({ changes: ['unarchived'] })).detail).toBe('Anna restored this project');
    expect(bellText(proj({ changes: ['deleted'] })).detail).toBe('Anna deleted this project');
    expect(bellText(proj({ changes: ['renamed', 'archived'], newName: 'X' })).detail).toBe('Anna renamed, archived');
  });

  it('still describes reminders', () => {
    const item: BellItem = {
      kind: 'reminder', taskId: 't1', projectId: null,
      data: { title: 'Ship', projectName: 'Web', dueDate: '2026-10-10', offsetDays: 0, daysLeft: 0 },
    };
    expect(bellText(item)).toEqual({ title: 'Ship', detail: 'Due today · Web' });
    expect(bellHref('acme', item)).toBe('/acme/tasks/t1');
  });
});

describe('bellHref', () => {
  it('links each kind', () => {
    expect(bellHref('acme', task({}))).toBe('/acme/tasks/t1');
    expect(bellHref('acme', { ...task({}), taskId: null })).toBe('/acme');
    expect(bellHref('acme', proj({}))).toBe('/acme/projects/p1');
    expect(bellHref('acme', proj({ changes: ['renamed', 'archived'] }))).toBe('/acme/settings/projects');
    expect(bellHref('acme', proj({ changes: ['archived', 'unarchived'] }))).toBe('/acme/projects/p1');
    expect(bellHref('acme', proj({ changes: ['deleted'] }))).toBe('/acme');
    expect(bellHref('acme', proj({}, null))).toBe('/acme');
  });
});

describe('pickToasts', () => {
  const at = (iso: string) => new Date(iso);
  const since = at('2026-10-07T10:00:00Z').getTime();
  const item = (kind: BellItem['kind'], createdAt: string, readAt: string | null = null, id = createdAt) =>
    ({ id, kind, createdAt: at(createdAt), readAt: readAt ? at(readAt) : null });

  it('keeps unread change items newer than the cutoff, newest first', () => {
    const picked = pickToasts([
      item('task_change', '2026-10-07T10:00:01Z'),
      item('project_change', '2026-10-07T10:00:05Z'),
      item('task_change', '2026-10-07T09:59:59Z'),
      item('reminder', '2026-10-07T10:00:09Z'),
      item('digest', '2026-10-07T10:00:09Z', null, 'd'),
      item('task_change', '2026-10-07T10:00:07Z', '2026-10-07T10:00:08Z'),
    ], since);
    expect(picked.map((i) => i.id)).toEqual(['2026-10-07T10:00:05Z', '2026-10-07T10:00:01Z']);
  });

  it('accepts serialized dates', () => {
    expect(pickToasts([{ kind: 'task_change', createdAt: '2026-10-07T10:00:01Z', readAt: null }], since)).toHaveLength(1);
  });
});
