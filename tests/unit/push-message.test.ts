import { describe, expect, it } from 'vitest';
import { pushMessage } from '@/server/push/message';

const base = { id: 'n1', taskId: 't1', projectId: 'p1' };

describe('pushMessage', () => {
  it('mention: bell copy, task link, id as tag', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'mention',
      data: { title: 'Fix login', projectName: 'Web', actorName: 'Anna', where: ['comment'], comment: 'see this' },
    });
    expect(m).toEqual({ title: 'Anna mentioned you', body: 'Fix login: “see this”', url: '/acme/tasks/t1', tag: 'n1' });
  });

  it('task change: title is the task, body the bell detail', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'task_change',
      data: { title: 'Fix login', projectName: 'Web', actorName: 'Anna', changes: ['status'], status: 'Done' },
    });
    expect(m.title).toBe('Fix login');
    expect(m.body).toBe('Anna moved to Done');
  });

  it('deleted project links to the workspace, like the bell', () => {
    const m = pushMessage('acme', {
      ...base, taskId: null, kind: 'project_change',
      data: { projectName: 'Web', actorName: 'Anna', changes: ['deleted'] },
    });
    expect(m.url).toBe('/acme');
  });

  it('truncates a long body to 180 chars', () => {
    const m = pushMessage('acme', {
      ...base, kind: 'mention',
      data: { title: 'T', projectName: 'Web', actorName: 'Anna', where: ['comment'], comment: 'x'.repeat(400) },
    });
    expect(m.body.length).toBe(180);
    expect(m.body.endsWith('…')).toBe(true);
  });
});
