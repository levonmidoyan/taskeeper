import { viewPaths } from '@better-auth-ui/core';

export type PaletteGroup = 'actions' | 'pages' | 'settings';

export type PaletteAction = {
  id: string;
  label: string;
  group: PaletteGroup;
  href?: string;
  command?: 'new-task';
  /** Other words people type for it; matched like the label, never shown. */
  keywords?: string[];
};

export const PALETTE_GROUPS: { id: PaletteGroup; heading: string }[] = [
  { id: 'actions', heading: 'Actions' },
  { id: 'pages', heading: 'Pages' },
  { id: 'settings', heading: 'Settings' },
];

const PROJECT_PATH = /^\/[^/]+\/projects\/([^/]+)/;

/**
 * What the palette can do besides search: every page the rail and settings
 * menus reach. On a project page the project's views join the list, named
 * after the project so they read on their own.
 */
export function paletteActions(workspaceSlug: string, pathname: string, projectName?: string): PaletteAction[] {
  const base = `/${workspaceSlug}`;
  const actions: PaletteAction[] = [
    { id: 'new-task', label: 'New task', group: 'actions', command: 'new-task', keywords: ['create', 'add'] },
    { id: 'new-workspace', label: 'New workspace', group: 'actions', href: '/new-workspace', keywords: ['create'] },

    { id: 'for-you', label: 'For you', group: 'pages', href: base, keywords: ['home', 'dashboard'] },
    { id: 'tasks', label: 'All tasks', group: 'pages', href: `${base}/tasks` },
    { id: 'todo', label: 'My To-do', group: 'pages', href: `${base}/todo`, keywords: ['personal', 'checklist'] },
    { id: 'calendar', label: 'My calendar', group: 'pages', href: `${base}/calendar`, keywords: ['due', 'schedule'] },
    { id: 'recent', label: 'Recent', group: 'pages', href: `${base}/recent`, keywords: ['history'] },
    { id: 'starred', label: 'Starred', group: 'pages', href: `${base}/starred`, keywords: ['favorites'] },
    { id: 'api-docs', label: 'API docs', group: 'pages', href: '/docs/api', keywords: ['rest', 'reference', 'developer'] },

    { id: 'workspace-settings', label: 'Workspace settings', group: 'settings', href: `${base}/settings/general`, keywords: ['name', 'logo', 'timezone'] },
    { id: 'members', label: 'Workspace members', group: 'settings', href: `${base}/settings/members`, keywords: ['invite', 'people', 'team', 'roles'] },
    { id: 'archived-projects', label: 'Archived projects', group: 'settings', href: `${base}/settings/projects`, keywords: ['restore'] },
    { id: 'profile', label: 'Account profile', group: 'settings', href: `/settings/${viewPaths.settings.account}`, keywords: ['name', 'email', 'avatar', 'photo'] },
    { id: 'security', label: 'Account security', group: 'settings', href: `/settings/${viewPaths.settings.security}`, keywords: ['password', 'sessions', 'two-factor', '2fa', 'passkeys'] },
    { id: 'preferences', label: 'Account preferences', group: 'settings', href: '/settings/preferences', keywords: ['theme', 'notifications', 'timezone'] },
    { id: 'api-tokens', label: 'API tokens', group: 'settings', href: '/settings/api-tokens', keywords: ['keys', 'access'] },
  ];

  const projectId = PROJECT_PATH.exec(pathname)?.[1];
  if (projectId && projectName) {
    // Same order as the project's view tabs.
    for (const view of ['summary', 'board', 'list', 'calendar'] as const) {
      actions.push({
        id: `view-${view}`,
        label: `${projectName}: ${view[0].toUpperCase()}${view.slice(1)}`,
        group: 'pages',
        href: `${base}/projects/${projectId}/${view}`,
      });
    }
  }
  return actions;
}

export function matchActions(actions: PaletteAction[], term: string): PaletteAction[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return actions;
  return actions.filter(
    (a) => a.label.toLowerCase().includes(needle) || a.keywords?.some((k) => k.includes(needle)),
  );
}
