import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { cache } from 'react';
import { db, workspaceChange } from '@/db';
import { CHANGE_EVENT, workspaceChannel } from '@/lib/live/channel';
import { pusherServer } from '@/server/changes/pusher';

/**
 * Sends the workspace's committed change counter to its channel. Read here,
 * after the response, not taken from the mutation: after() runs even when the
 * transaction rolled back, and a version that never committed would make
 * clients ignore the real one. Never throws; polling covers a lost publish.
 */
export async function publishWorkspaceVersion(workspaceId: string): Promise<void> {
  const server = pusherServer();
  if (!server) return;
  try {
    const [row] = await db
      .select({ version: workspaceChange.version })
      .from(workspaceChange)
      .where(eq(workspaceChange.workspaceId, workspaceId))
      .limit(1);
    await server.trigger(workspaceChannel(workspaceId), CHANGE_EVENT, { version: row?.version ?? 0 });
  } catch (error) {
    console.error('Live refresh: Pusher publish failed', error);
  }
}

// One set per request (React cache), never module-wide: a pending publish
// shared by two requests could go out before the second one commits.
const pendingForRequest = cache(() => new Set<string>());

/** Queues one publish per workspace for after this request's response. */
export function schedulePublish(workspaceId: string): void {
  if (!pusherServer()) return;
  const pending = pendingForRequest();
  if (pending.has(workspaceId)) return;
  pending.add(workspaceId);
  try {
    after(() => publishWorkspaceVersion(workspaceId));
  } catch {
    // No request (a script): best effort now; the safety poll covers a miss.
    void publishWorkspaceVersion(workspaceId);
  }
}
