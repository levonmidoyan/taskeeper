export type PaletteAction = { id: string; label: string; href?: string; command?: 'new-task' };

const PROJECT_PATH = /^\/[^/]+\/projects\/([^/]+)/;

/**
 * What the palette can do besides search. On a project page the project's
 * views join the list, named after the project so they read on their own.
 */
export function paletteActions(workspaceSlug: string, pathname: string, projectName?: string): PaletteAction[] {
  const base = `/${workspaceSlug}`;
  const actions: PaletteAction[] = [
    { id: 'new-task', label: 'New task', command: 'new-task' },
    { id: 'todo', label: 'My To-do', href: `${base}/todo` },
    { id: 'recent', label: 'Recent', href: `${base}/recent` },
    { id: 'starred', label: 'Starred', href: `${base}/starred` },
    { id: 'workspace-settings', label: 'Workspace settings', href: `${base}/settings/general` },
    { id: 'preferences', label: 'Account preferences', href: '/settings/preferences' },
  ];

  const projectId = PROJECT_PATH.exec(pathname)?.[1];
  if (projectId && projectName) {
    for (const view of ['board', 'list', 'summary'] as const) {
      actions.push({
        id: `view-${view}`,
        label: `${projectName}: ${view[0].toUpperCase()}${view.slice(1)}`,
        href: `${base}/projects/${projectId}/${view}`,
      });
    }
  }
  return actions;
}

export function matchActions(actions: PaletteAction[], term: string): PaletteAction[] {
  const needle = term.trim().toLowerCase();
  return needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions;
}
