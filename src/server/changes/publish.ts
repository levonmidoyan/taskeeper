import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db, workspaceChange } from '@/db';
import { CHANGE_EVENT, workspaceChannel } from '@/lib/live/channel';
import { pusherServer } from '@/server/changes/pusher';

async function committedVersion(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ version: workspaceChange.version })
    .from(workspaceChange)
    .where(eq(workspaceChange.workspaceId, workspaceId))
    .limit(1);
  return row?.version ?? 0;
}

// Publishes queued but not yet reading the counter, per workspace.
const queued = new Map<string, Promise<void>>();

/**
 * Sends the workspace's committed change counter to its channel. Read here,
 * after the response, not taken from the mutation: after() runs even when the
 * transaction rolled back, and a version that never committed would make
 * clients ignore the real one. Never throws; polling covers a lost publish.
 *
 * Calls that arrive before the counter is read share one publish: each caller
 * has already committed, and the read comes after all of them. That folds a
 * request's several emits (and concurrent requests') into one Pusher message.
 */
export function publishWorkspaceVersion(workspaceId: string): Promise<void> {
  const waiting = queued.get(workspaceId);
  if (waiting) return waiting;
  const publish = (async () => {
    // Let the request's other after() callbacks, started together, join.
    await new Promise((resolve) => setTimeout(resolve, 0));
    queued.delete(workspaceId);
    const server = pusherServer();
    if (!server) return;
    try {
      const version = await committedVersion(workspaceId);
      await server.trigger(workspaceChannel(workspaceId), CHANGE_EVENT, { version });
    } catch (error) {
      console.error('Live refresh: Pusher publish failed', error);
    }
  })();
  queued.set(workspaceId, publish);
  return publish;
}

const COMMIT_WAIT_MS = [100, 200, 400, 800, 1_500];

/**
 * Outside a request (a script) there is no after(), and the caller's
 * transaction may still be open. Waits until the counter this write bumped to
 * is committed; a rolled-back write never gets there and publishes nothing.
 */
async function publishOnceCommitted(workspaceId: string, version: number): Promise<void> {
  try {
    for (const ms of COMMIT_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      if ((await committedVersion(workspaceId)) >= version) {
        await publishWorkspaceVersion(workspaceId);
        return;
      }
    }
  } catch (error) {
    console.error('Live refresh: Pusher publish failed', error);
  }
}

/**
 * Publishes after this request's response. `version` is what the write bumped
 * the counter to, used only outside a request to wait for the commit.
 */
export function schedulePublish(workspaceId: string, version: number): void {
  if (!pusherServer()) return;
  try {
    after(() => publishWorkspaceVersion(workspaceId));
  } catch {
    void publishOnceCommitted(workspaceId, version);
  }
}
