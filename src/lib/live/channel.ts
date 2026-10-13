/**
 * Names shared by the server publish, the auth route and the browser. No server
 * imports: LiveRefresh bundles this.
 */
export const CHANGE_EVENT = 'change';

const PREFIX = 'private-workspace-';

/** What the workspace layout hands LiveRefresh when Pusher is configured. */
export type PusherClientConfig = { key: string; cluster: string };

export function workspaceChannel(workspaceId: string): string {
  return PREFIX + workspaceId;
}

/** The workspace id in a channel name, or null for anything else. */
export function parseWorkspaceChannel(name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const id = name.slice(PREFIX.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
