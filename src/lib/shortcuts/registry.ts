export type Scope = 'global' | 'nav' | 'detail';
export type ShortcutGroup = 'General' | 'Navigation' | 'Task' | 'Go to';

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['General', 'Navigation', 'Task', 'Go to'];

/**
 * Every shortcut in the app, declared once. Components attach behaviour with
 * useShortcut(id, …); the help overlay renders this table, so the two cannot
 * drift. `nav` keys work with no task open, `detail` keys only with one open,
 * `global` keys in both.
 */
export const SHORTCUTS = [
  { id: 'general.help', keys: ['?'], scope: 'global', group: 'General', label: 'Show keyboard shortcuts' },
  { id: 'general.palette', keys: ['Mod+k'], scope: 'global', group: 'General', label: 'Search and commands' },
  { id: 'general.search', keys: ['/'], scope: 'nav', group: 'General', label: 'Search' },
  { id: 'general.create', keys: ['c'], scope: 'nav', group: 'General', label: 'Create task' },
  { id: 'general.filter', keys: ['f'], scope: 'nav', group: 'General', label: 'Add filter' },

  { id: 'nav.next', keys: ['j', 'ArrowDown'], scope: 'nav', group: 'Navigation', label: 'Next task' },
  { id: 'nav.prev', keys: ['k', 'ArrowUp'], scope: 'nav', group: 'Navigation', label: 'Previous task' },
  { id: 'nav.left', keys: ['h', 'ArrowLeft'], scope: 'nav', group: 'Navigation', label: 'Column to the left (board)' },
  { id: 'nav.right', keys: ['l', 'ArrowRight'], scope: 'nav', group: 'Navigation', label: 'Column to the right (board)' },
  { id: 'nav.open', keys: ['o'], scope: 'nav', group: 'Navigation', label: 'Open focused task (or Enter)' },
  { id: 'nav.select', keys: ['x'], scope: 'nav', group: 'Navigation', label: 'Select focused row (list)' },
  { id: 'nav.clear', keys: ['Escape'], scope: 'nav', group: 'Navigation', label: 'Clear selection (list)' },

  { id: 'detail.next', keys: ['j'], scope: 'detail', group: 'Task', label: 'Next task' },
  { id: 'detail.prev', keys: ['k'], scope: 'detail', group: 'Task', label: 'Previous task' },
  { id: 'detail.title', keys: ['e'], scope: 'detail', group: 'Task', label: 'Edit title' },
  { id: 'detail.status', keys: ['s'], scope: 'detail', group: 'Task', label: 'Change status' },
  { id: 'detail.priority', keys: ['p'], scope: 'detail', group: 'Task', label: 'Change priority' },
  { id: 'detail.assignee', keys: ['a'], scope: 'detail', group: 'Task', label: 'Assign' },
  { id: 'detail.assignMe', keys: ['i'], scope: 'detail', group: 'Task', label: 'Assign to me' },
  { id: 'detail.labels', keys: ['l'], scope: 'detail', group: 'Task', label: 'Add labels' },
  { id: 'detail.due', keys: ['d'], scope: 'detail', group: 'Task', label: 'Set due date' },
  { id: 'detail.comment', keys: ['m'], scope: 'detail', group: 'Task', label: 'Comment' },
  { id: 'detail.delete', keys: ['#', 'Delete'], scope: 'detail', group: 'Task', label: 'Delete task' },

  { id: 'goto.home', keys: ['g h'], scope: 'global', group: 'Go to', label: 'For you' },
  { id: 'goto.todo', keys: ['g t'], scope: 'global', group: 'Go to', label: 'My To-do' },
  { id: 'goto.calendar', keys: ['g c'], scope: 'global', group: 'Go to', label: 'Calendar (project’s, inside a project)' },
  { id: 'goto.board', keys: ['g b'], scope: 'global', group: 'Go to', label: 'Project board' },
  { id: 'goto.list', keys: ['g l'], scope: 'global', group: 'Go to', label: 'Project list' },
  { id: 'goto.summary', keys: ['g s'], scope: 'global', group: 'Go to', label: 'Project summary' },
] as const satisfies readonly {
  id: string; keys: readonly string[]; scope: Scope; group: ShortcutGroup; label: string;
}[];

export type ShortcutDef = (typeof SHORTCUTS)[number];
export type ShortcutId = ShortcutDef['id'];

export function shortcutById(id: ShortcutId): ShortcutDef {
  return SHORTCUTS.find((s) => s.id === id)!;
}
