import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { comment, commentReaction, db, project, task } from '@/db';
import { REACTION_EMOJIS } from '@/lib/reactions';
import { err, ok, withAction, type Result } from '@/lib/result';
import type { WorkspaceContext } from '@/lib/session';
import { emitChange } from '@/server/changes/service';
import { commentExcerpt, notifyTaskChange } from '@/server/notifications/changes';

const setSchema = z.object({
  commentId: z.string().min(1),
  emoji: z.enum(REACTION_EMOJIS, { error: 'Unknown reaction.' }),
  on: z.boolean(),
});

/**
 * Adds the caller's reaction (`on`) or takes it back. The caller says which, so
 * a retried or doubled request lands in the same state instead of flipping it.
 * Only a real add notifies, and only the comment's author: a reaction is a nod,
 * not news for everyone on the task.
 */
export async function setReaction(
  ctx: WorkspaceContext,
  input: { commentId: string; emoji: string; on: boolean },
): Promise<Result<{ reacted: boolean }>> {
  return withAction(async () => {
    const parsed = setSchema.safeParse(input);
    if (!parsed.success) return err(parsed.error.issues[0].message);
    const { commentId, emoji, on } = parsed.data;

    // Same gate as createComment: an archived project's thread is read-only.
    const [target] = await db
      .select({ authorId: comment.authorId, taskId: comment.taskId, body: comment.body })
      .from(comment)
      .innerJoin(task, eq(task.id, comment.taskId))
      .innerJoin(project, and(eq(project.id, task.projectId), isNull(project.archivedAt)))
      .where(and(eq(comment.id, commentId), eq(comment.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!target) return err('Comment not found.');

    await db.transaction(async (tx) => {
      if (on) {
        const added = await tx
          .insert(commentReaction)
          // From the context, never the input.
          .values({ commentId, workspaceId: ctx.workspaceId, userId: ctx.userId, emoji })
          .onConflictDoNothing()
          .returning({ emoji: commentReaction.emoji });
        if (added.length > 0 && target.authorId && target.authorId !== ctx.userId) {
          await notifyTaskChange(ctx, tx, {
            taskId: target.taskId,
            changes: ['reaction'],
            recipients: [target.authorId],
            reaction: { emoji, comment: commentExcerpt(target.body) },
          });
        }
      } else {
        await tx.delete(commentReaction).where(and(
          eq(commentReaction.commentId, commentId),
          eq(commentReaction.userId, ctx.userId),
          eq(commentReaction.emoji, emoji),
        ));
      }
      await emitChange(ctx, {}, tx);
    });

    return ok({ reacted: on });
  });
}
