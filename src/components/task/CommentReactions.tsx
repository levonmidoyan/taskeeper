'use client';

import { IconMoodPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import * as Tooltip from '@/components/ui/tooltip';
import {
  applyToggle, reactorsLabel, REACTION_EMOJIS, type CommentReaction, type ReactionEmoji,
} from '@/lib/reactions';
import { settle } from '@/lib/settle';
import { setReactionAction } from '@/server/comments/actions';
import { cn } from '@/utils/cn';
import { Hint } from '@/components/shell/ShortcutHint';

/**
 * A comment's reaction chips plus the button that adds one. Each click applies
 * to the previous optimistic state (a reducer, not a value), so fast repeated
 * clicks compose instead of all toggling the stale server prop.
 */
export function CommentReactions({
  workspaceSlug,
  commentId,
  reactions,
  currentUserId,
}: {
  workspaceSlug: string;
  commentId: string;
  reactions: CommentReaction[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, toggleShown] = useOptimistic(
    reactions,
    (state: CommentReaction[], emoji: ReactionEmoji) => applyToggle(state, emoji, currentUserId),
  );
  const [, startTransition] = useTransition();

  const mine = new Set(shown.filter((r) => r.reactedByMe).map((r) => r.emoji));

  function toggle(emoji: ReactionEmoji) {
    setOpen(false);
    // Sent as the state wanted, not a flip, so a retried request cannot undo itself.
    const on = !mine.has(emoji);
    startTransition(async () => {
      toggleShown(emoji);
      const result = await settle(setReactionAction(workspaceSlug, { commentId, emoji, on }));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {shown.map((r) => (
          <Tooltip.Root key={r.emoji}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-pressed={r.reactedByMe}
                aria-label={`React with ${r.emoji} (${r.count})`}
                onClick={() => toggle(r.emoji)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-full px-2 text-paragraph-xs ring-1 ring-inset transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
                  r.reactedByMe
                    ? 'bg-primary-alpha-10 text-primary-base ring-primary-base'
                    : 'bg-bg-white-0 text-text-sub-600 ring-stroke-soft-200 hover:bg-bg-soft-200',
                )}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="tabular-nums">{r.count}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{reactorsLabel(r, currentUserId)}</Tooltip.Content>
          </Tooltip.Root>
        ))}

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Hint label="Add reaction">
              <CompactButton.Root
                type="button"
                variant="ghost"
                size="medium"
                aria-label="Add reaction"
                className="text-text-soft-400"
              >
                <CompactButton.Icon as={IconMoodPlus} />
              </CompactButton.Root>
            </Hint>
          </Popover.Trigger>
          <Popover.Content align="start" showArrow={false} sideOffset={6} className="p-1.5">
            <div className="flex gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mine.has(emoji)}
                  aria-label={`React with ${emoji}`}
                  onClick={() => toggle(emoji)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-lg transition-colors duration-150',
                    'hover:bg-bg-soft-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
                    mine.has(emoji) && 'bg-primary-alpha-10 ring-1 ring-inset ring-primary-base',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
    </Tooltip.Provider>
  );
}
