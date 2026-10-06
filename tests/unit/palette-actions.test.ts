import { describe, expect, it } from 'vitest';
import { matchActions, PALETTE_GROUPS, paletteActions } from '@/components/shell/palette-actions';

describe('paletteActions', () => {
  it('lists the workspace actions, pages and settings', () => {
    expect(paletteActions('acme', '/acme').map((a) => a.label)).toEqual([
      'New task', 'New workspace',
      'For you', 'All tasks', 'My To-do', 'My calendar', 'Recent', 'Starred', 'API docs',
      'Workspace settings', 'Workspace members', 'Archived projects',
      'Account profile', 'Account security', 'Account preferences', 'API tokens',
    ]);
  });

  it('puts every action in a known group', () => {
    const groups = new Set(PALETTE_GROUPS.map((g) => g.id));
    expect(paletteActions('acme', '/acme/projects/p1', 'Website').every((a) => groups.has(a.group))).toBe(true);
  });

  it('adds the current project views on a project page, in tab order', () => {
    const actions = paletteActions('acme', '/acme/projects/p1/board', 'Website');
    expect(actions.slice(-4)).toEqual([
      { id: 'view-summary', label: 'Website: Summary', group: 'pages', href: '/acme/projects/p1/summary' },
      { id: 'view-board', label: 'Website: Board', group: 'pages', href: '/acme/projects/p1/board' },
      { id: 'view-list', label: 'Website: List', group: 'pages', href: '/acme/projects/p1/list' },
      { id: 'view-calendar', label: 'Website: Calendar', group: 'pages', href: '/acme/projects/p1/calendar' },
    ]);
  });

  it('points at the right routes', () => {
    const byId = Object.fromEntries(paletteActions('acme', '/acme').map((a) => [a.id, a]));
    expect(byId['new-task'].command).toBe('new-task');
    expect(byId['new-task'].href).toBeUndefined();
    expect(byId['for-you'].href).toBe('/acme');
    expect(byId.tasks.href).toBe('/acme/tasks');
    expect(byId.todo.href).toBe('/acme/todo');
    expect(byId.calendar.href).toBe('/acme/calendar');
    expect(byId['workspace-settings'].href).toBe('/acme/settings/general');
    expect(byId.members.href).toBe('/acme/settings/members');
    expect(byId['archived-projects'].href).toBe('/acme/settings/projects');
    expect(byId.profile.href).toBe('/settings/account');
    expect(byId.security.href).toBe('/settings/security');
    expect(byId.preferences.href).toBe('/settings/preferences');
    expect(byId['api-tokens'].href).toBe('/settings/api-tokens');
    expect(byId['api-docs'].href).toBe('/docs/api');
    expect(byId['new-workspace'].href).toBe('/new-workspace');
  });
});

describe('matchActions', () => {
  it('filters labels case-insensitively', () => {
    const actions = paletteActions('acme', '/acme');
    expect(matchActions(actions, 'SETT').map((a) => a.id)).toEqual(['workspace-settings']);
    expect(matchActions(actions, '  ')).toEqual(actions);
  });

  it('matches keywords as well as labels', () => {
    const actions = paletteActions('acme', '/acme');
    expect(matchActions(actions, 'password').map((a) => a.id)).toEqual(['security']);
    expect(matchActions(actions, 'Invite').map((a) => a.id)).toEqual(['members']);
  });
});
