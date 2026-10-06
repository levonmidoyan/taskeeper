import { describe, expect, it } from 'vitest';
import { matchActions, paletteActions } from '@/components/shell/palette-actions';

describe('paletteActions', () => {
  it('lists the workspace actions', () => {
    expect(paletteActions('acme', '/acme').map((a) => a.label)).toEqual([
      'New task', 'My To-do', 'Recent', 'Starred', 'Workspace settings', 'Account preferences',
    ]);
  });

  it('adds the current project views on a project page', () => {
    const actions = paletteActions('acme', '/acme/projects/p1/board', 'Website');
    expect(actions.slice(-3)).toEqual([
      { id: 'view-board', label: 'Website: Board', href: '/acme/projects/p1/board' },
      { id: 'view-list', label: 'Website: List', href: '/acme/projects/p1/list' },
      { id: 'view-summary', label: 'Website: Summary', href: '/acme/projects/p1/summary' },
    ]);
  });

  it('points at the right routes', () => {
    const byId = Object.fromEntries(paletteActions('acme', '/acme').map((a) => [a.id, a]));
    expect(byId['new-task']).toEqual({ id: 'new-task', label: 'New task', command: 'new-task' });
    expect(byId.todo.href).toBe('/acme/todo');
    expect(byId['workspace-settings'].href).toBe('/acme/settings/general');
    expect(byId.preferences.href).toBe('/settings/preferences');
  });
});

describe('matchActions', () => {
  it('filters labels case-insensitively', () => {
    const actions = paletteActions('acme', '/acme');
    expect(matchActions(actions, 'SETT').map((a) => a.id)).toEqual(['workspace-settings']);
    expect(matchActions(actions, '  ')).toEqual(actions);
  });
});
