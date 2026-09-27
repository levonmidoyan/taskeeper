import { cookies } from 'next/headers';
import { LAST_WORKSPACE_COOKIE } from '@/lib/last-workspace';
import { resolveWorkspace, type WorkspaceContext } from '@/lib/session';
import { listMyWorkspaces } from '@/server/workspaces/queries';

/**
 * The workspace whose rail a route outside any workspace (account settings,
 * new workspace) should show: the one the user came from, else their first.
 * The cookie is only a hint, so membership is checked again. Null when the
 * user belongs to no workspace at all.
 */
export async function resolveShellWorkspace(userId: string): Promise<WorkspaceContext | null> {
  const remembered = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const ctx = remembered ? await resolveWorkspace(userId, remembered) : null;
  if (ctx) return ctx;

  const [first] = await listMyWorkspaces(userId);
  return first ? resolveWorkspace(userId, first.slug) : null;
}
