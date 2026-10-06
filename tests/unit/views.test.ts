import { describe, expect, it } from 'vitest';
import { defaultState, layoutPath, shareToast, viewHref } from '@/lib/views';

describe('views helpers', () => {
  it('defaultState: board shows all, the rest open', () => {
    expect(defaultState('board')).toBe('all');
    expect(defaultState('list')).toBe('open');
    expect(defaultState('calendar')).toBe('open');
  });

  it('layoutPath', () => {
    expect(layoutPath('acme', 'p1', 'board')).toBe('/acme/projects/p1');
    expect(layoutPath('acme', 'p1', 'list')).toBe('/acme/projects/p1/list');
    expect(layoutPath('acme', 'p1', 'calendar')).toBe('/acme/projects/p1/calendar');
    expect(layoutPath('acme', null, 'list')).toBe('/acme/tasks');
    expect(layoutPath('acme', null, 'calendar')).toBe('/acme/tasks?layout=calendar');
  });

  it('viewHref always carries state, the filter, and a list sort', () => {
    expect(viewHref('acme', { id: 'v1', projectId: 'p1', layout: 'list', filter: { q: 'x' }, sort: 'due.asc' }))
      .toBe('/acme/projects/p1/list?view=v1&state=open&q=x&sort=due.asc');
    expect(viewHref('acme', { id: 'v2', projectId: 'p1', layout: 'board', filter: {}, sort: 'due.asc' }))
      .toBe('/acme/projects/p1?view=v2&state=all');
    expect(viewHref('acme', { id: 'v3', projectId: null, layout: 'calendar', filter: { state: 'done' }, sort: null }))
      .toBe('/acme/tasks?layout=calendar&view=v3&state=done');
  });

  it('shareToast speaks to the owner, or about the owner when an admin acts', () => {
    expect(shareToast({ name: 'Bugs', shared: false, mine: true })).toBe('Shared with the workspace.');
    expect(shareToast({ name: 'Bugs', shared: true, mine: true })).toBe('Only you can see this view now.');
    expect(shareToast({ name: 'Bugs', shared: true, mine: false })).toBe('“Bugs” is private to its owner now.');
  });
});
