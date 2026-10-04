import { describe, expect, it } from 'vitest';
import { chipValues, removeField, setValues, toggleOp, valueOptions } from '@/components/filters/filter-chips';

const options = {
  statuses: [{ id: 's1', name: 'Todo', color: 'muted', isDone: false, icon: null }],
  members: [{ userId: 'u1', name: 'Bob', image: null }],
  labels: [{ id: 'l1', name: 'bug', color: 'red' }],
};

describe('filter chips', () => {
  it('names values, with Me / Unassigned / Unknown', () => {
    expect(chipValues('assignee', { assignee: { op: 'is', ids: ['me', 'none', 'u1', 'gone'] } }, options))
      .toBe('Me, Unassigned, Bob, Unknown');
    expect(chipValues('priority', { priority: { op: 'is', values: ['urgent', 'low'] } }, options)).toBe('Urgent, Low');
    expect(chipValues('due', { due: { preset: 'next_7d' } }, options)).toBe('Next 7 days');
    expect(chipValues('due', { due: { from: '2026-10-01', to: '2026-10-31' } }, options)).toBe('2026-10-01 – 2026-10-31');
    expect(chipValues('due', { due: { to: '2026-10-31' } }, options)).toBe('until 2026-10-31');
    expect(chipValues('labels', { labels: { op: 'none', ids: ['l1'] } }, options)).toBe('bug');
  });

  it('toggles is/not (any/none for labels)', () => {
    expect(toggleOp('priority', { priority: { op: 'is', values: ['low'] } })).toEqual({ priority: { op: 'not', values: ['low'] } });
    expect(toggleOp('labels', { labels: { op: 'any', ids: ['l1'] } })).toEqual({ labels: { op: 'none', ids: ['l1'] } });
  });

  it('setValues keeps the op, and an empty selection removes the field', () => {
    expect(setValues('assignee', { assignee: { op: 'not', ids: ['me'] } }, ['me', 'u1']))
      .toEqual({ assignee: { op: 'not', ids: ['me', 'u1'] } });
    expect(setValues('assignee', { assignee: { op: 'is', ids: ['me'] } }, [])).toEqual({});
    expect(setValues('priority', {}, ['high'])).toEqual({ priority: { op: 'is', values: ['high'] } });
  });

  it('removeField', () => {
    expect(removeField('q', { q: 'x', state: 'open' })).toEqual({ state: 'open' });
    expect(removeField('due', { due: { preset: 'today' }, state: 'all' })).toEqual({ state: 'all' });
  });

  it('assignee options start with Me and Unassigned', () => {
    expect(valueOptions('assignee', options).map((o) => o.label)).toEqual(['Me', 'Unassigned', 'Bob']);
    expect(valueOptions('createdBy', options).map((o) => o.label)).toEqual(['Me', 'Bob']);
  });
});
