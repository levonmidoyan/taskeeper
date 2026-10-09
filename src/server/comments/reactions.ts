import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { comment, commentReaction, db, project, task } from '@/db';
import { REACTION_EMOJIS } from '@/lib/reactions';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { emitChange } from '@/server/changes/service';
import { commentExcerpt, notifyTaskChange } from '@/server/notifications/changes';

const toggleSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.enum(REACTION_EMOJIS, { error: 'Unknown reaction.' }),
});

/**
 * Adds the caller's reaction, or takes it back if it is already there. Only an
 * add notifies, and only the comment's author: a reaction is a nod, not news
 * for everyone on the task.
 */
export async function toggleReaction(
  ctx: WorkspaceContext,
  input: { commentId: string; emoji: string },
): Promise<Result<{ reacted: boolean }>> {
  return withAction(async () => {
    const parsed = toggleSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);
    const { commentId, emoji } = parsed.data;

    // Same gate as createComment: an archived project's thread is read-only.
    const [target] = await db
      .select({ authorId: comment.authorId, taskId: comment.taskId, body: comment.body })
      .from(comment)
      .innerJoin(task, eq(task.id, comment.taskId))
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(comment.id, commentId), eq(comment.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!target) return err('Comment not found.');

    const reacted = await db.transaction(async (tx) => {
      const added = await tx
        .insert(commentReaction)
        // From the context, never the input.
        .values({ commentId, workspaceId: ctx.workspaceId, userId: ctx.userId, emoji })
        .onConflictDoNothing()
        .returning({ emoji: commentReaction.emoji });

      if (added.length === 0) {
        await tx.delete(commentReaction).where(and(
          eq(commentReaction.commentId, commentId),
          eq(commentReaction.userId, ctx.userId),
          eq(commentReaction.emoji, emoji),
        ));
      } else if (target.authorId && target.authorId !== ctx.userId) {
        await notifyTaskChange(ctx, tx, {
          taskId: target.taskId,
          changes: ['reaction'],
          recipients: [target.authorId],
          reaction: { emoji, comment: commentExcerpt(target.body) },
        });
      }
      await emitChange(ctx, {}, tx);
      return added.length > 0;
    });

    return ok({ reacted });
  });
}
