import { and, asc, eq } from 'drizzle-orm';
import { comment, db, taskActivity, user } from '@/db';
import type { WorkspaceContext } from '@/lib/session';
import { ACTIVITY_KINDS, type ActivityKind } from './service';

export type FeedEntry =
  | {
      type: 'comment';
      id: string;
      createdAt: Date;
      authorId: string;
      authorName: string;
      body: string;
      editedAt: Date | null;
    }
  | {
      type: 'activity';
      id: string;
      createdAt: Date;
      actorId: string;
      actorName: string;
      kind: ActivityKind;
      from: string | null;
      to: string | null;
    };

function isKnownKind(kind: string): kind is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(kind);
}

/**
 * Two indexed reads merged in memory rather than a UNION: the two row shapes
 * share no columns, and a task's feed is small enough that sorting it here costs
 * less than the casts a UNION would need. Both halves filter on workspace_id, so
 * a task id from another workspace yields nothing.
 */
export async function listTaskFeed(
  ctx: WorkspaceContext,
  taskId: string,
): Promise<FeedEntry[]> {
  const [comments, activity] = await Promise.all([
    db
      .select({
        id: comment.id,
        createdAt: comment.createdAt,
        authorId: comment.authorId,
        authorName: user.name,
        body: comment.body,
        editedAt: comment.editedAt,
      })
      .from(comment)
      .innerJoin(user, eq(user.id, comment.authorId))
      .where(and(eq(comment.taskId, taskId), eq(comment.workspaceId, ctx.workspaceId)))
      .orderBy(asc(comment.createdAt)),
    db
      .select({
        id: taskActivity.id,
        createdAt: taskActivity.createdAt,
        actorId: taskActivity.actorId,
        actorName: user.name,
        kind: taskActivity.kind,
        from: taskActivity.fromValue,
        to: taskActivity.toValue,
      })
      .from(taskActivity)
      .innerJoin(user, eq(user.id, taskActivity.actorId))
      .where(and(eq(taskActivity.taskId, taskId), eq(taskActivity.workspaceId, ctx.workspaceId)))
      .orderBy(asc(taskActivity.createdAt)),
  ]);

  const entries: FeedEntry[] = [
    ...comments.map((c) => ({ type: 'comment' as const, ...c })),
    // A kind written by an older deploy that this build does not know is dropped
    // rather than rendered as raw text.
    ...activity
      .filter((a) => isKnownKind(a.kind))
      .map((a) => ({ type: 'activity' as const, ...a, kind: a.kind as ActivityKind })),
  ];

  // Same-millisecond ties (a create and its activity row) fall back to id so the
  // order is stable between reads.
  return entries.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}
