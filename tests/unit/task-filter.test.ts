import { describe, expect, it } from 'vitest';
import {
  filterFromParams, filterToParams, hiddenStatusIds, isFiltered, parseTaskFilter, sameFilter,
  withDefaultState, type TaskFilter,
} from '@/lib/task-filter';

describe('parseTaskFilter', () => {
  it('keeps valid fields and strips unknown keys', () => {
    expect(parseTaskFilter({ priority: { op: 'is', values: ['high'] }, junk: 1 }))
      .toEqual({ priority: { op: 'is', values: ['high'] } });
  });

  it('drops empty arrays, blank text and empty due ranges', () => {
    expect(parseTaskFilter({ assignee: { op: 'is', ids: [] }, q: '   ', due: {} })).toEqual({});
  });

  it('dedupes ids and trims text', () => {
    expect(parseTaskFilter({ labels: { op: 'any', ids: ['a', 'a', 'b'] }, q: '  deploy ' }))
      .toEqual({ labels: { op: 'any', ids: ['a', 'b'] }, q: 'deploy' });
  });

  it('rejects a bad value anywhere', () => {
    expect(parseTaskFilter({ priority: { op: 'is', values: ['nope'] } })).toBeNull();
    expect(parseTaskFilter({ due: { from: '2026-02-30' } })).toBeNull();
    expect(parseTaskFilter('not an object')).toBeNull();
  });

  it('drops "none" from createdBy (a task always had a creator when made)', () => {
    expect(parseTaskFilter({ createdBy: { op: 'is', ids: ['none'] } })).toEqual({});
  });

  it('drops a reversed due range', () => {
    expect(parseTaskFilter({ due: { from: '2026-10-10', to: '2026-10-01' } })).toEqual({});
  });
});

describe('filterFromParams / filterToParams', () => {
  it('reads every field', () => {
    const params = new URLSearchParams(
      'state=done&status=s1,s2&priority=high,urgent&assignee=!me,none&labels=!l1&created=me&due=overdue&q=deploy',
    );
    expect(filterFromParams(params)).toEqual({
      state: 'done',
      status: { op: 'is', ids: ['s1', 's2'] },
      priority: { op: 'is', values: ['high', 'urgent'] },
      assignee: { op: 'not', ids: ['me', 'none'] },
      labels: { op: 'none', ids: ['l1'] },
      createdBy: { op: 'is', ids: ['me'] },
      due: { preset: 'overdue' },
      q: 'deploy',
    });
  });

  it('reads due ranges with either side open', () => {
    expect(filterFromParams({ due: '2026-10-01..2026-10-31' })).toEqual({ due: { from: '2026-10-01', to: '2026-10-31' } });
    expect(filterFromParams({ due: '..2026-10-31' })).toEqual({ due: { to: '2026-10-31' } });
    expect(filterFromParams({ due: '2026-10-01..' })).toEqual({ due: { from: '2026-10-01' } });
  });

  it('drops only the bad field', () => {
    expect(filterFromParams({ priority: 'nope', q: 'x', due: '2026-02-30..', assignee: '' }))
      .toEqual({ q: 'x' });
  });

  it('takes the first value of a repeated param', () => {
    expect(filterFromParams({ q: ['a', 'b'] })).toEqual({ q: 'a' });
  });

  it('round-trips', () => {
    const filter: TaskFilter = {
      state: 'open',
      priority: { op: 'not', values: ['none'] },
      assignee: { op: 'is', ids: ['me', 'u1'] },
      labels: { op: 'any', ids: ['l1'] },
      due: { from: '2026-10-01' },
      q: 'a b',
    };
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
  });

  it('writes params in a fixed order', () => {
    expect(filterToParams({ q: 'x', state: 'all', priority: { op: 'is', values: ['low'] } }).toString())
      .toBe('state=all&priority=low&q=x');
  });
});

describe('helpers', () => {
  it('withDefaultState fills only a missing state', () => {
    expect(withDefaultState({}, 'open')).toEqual({ state: 'open' });
    expect(withDefaultState({ state: 'done' }, 'open')).toEqual({ state: 'done' });
  });

  it('sameFilter ignores array order and duplicates', () => {
    expect(sameFilter(
      { assignee: { op: 'is', ids: ['b', 'a'] }, state: 'open' },
      { state: 'open', assignee: { op: 'is', ids: ['a', 'b', 'a'] } },
    )).toBe(true);
    expect(sameFilter({ state: 'open' }, { state: 'all' })).toBe(false);
  });

  it('isFiltered is false for only the default state', () => {
    expect(isFiltered({ state: 'open' }, 'open')).toBe(false);
    expect(isFiltered({ state: 'all' }, 'open')).toBe(true);
    expect(isFiltered({ state: 'open', q: 'x' }, 'open')).toBe(true);
  });

  it('hiddenStatusIds covers status and state', () => {
    const statuses = [{ id: 'todo', isDone: false }, { id: 'doing', isDone: false }, { id: 'done', isDone: true }];
    expect(hiddenStatusIds({ status: { op: 'is', ids: ['todo'] } }, statuses)).toEqual(['doing', 'done']);
    expect(hiddenStatusIds({ status: { op: 'not', ids: ['todo'] } }, statuses)).toEqual(['todo']);
    expect(hiddenStatusIds({ state: 'open' }, statuses)).toEqual(['done']);
    expect(hiddenStatusIds({ state: 'done' }, statuses)).toEqual(['todo', 'doing']);
    expect(hiddenStatusIds({ state: 'all' }, statuses)).toEqual([]);
  });
});
