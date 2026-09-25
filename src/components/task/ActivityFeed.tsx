'use client';

import { IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Markdown } from '@/components/task/Markdown';
import { RichTextField } from '@/components/task/RichTextField';
import * as Avatar from '@/components/ui/avatar';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import { describeActivity } from '@/lib/activity-text';
import { formatInZone } from '@/lib/dates';
import type { FeedEntry } from '@/server/activity/queries';
import {
  createCommentAction, deleteCommentAction, updateCommentAction,
} from '@/server/comments/actions';

export function ActivityFeed({
  taskId,
  feed,
  workspaceSlug,
  currentUserId,
  canModerate,
  timezone,
}: {
  taskId: string;
  feed: FeedEntry[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  // Bumped after a successful post: remounting the editor is how it is cleared.
  const [composerKey, setComposerKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft;
    if (!body.trim() || pending) return;

    startTransition(async () => {
      const result = await createCommentAction(workspaceSlug, { taskId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft('');
      setComposerKey((k) => k + 1);
      router.refresh();
    });
  }

  function startEdit(entry: { id: string; body: string }) {
    setEditDraft(entry.body);
    setEditingId(entry.id);
  }

  function onEdit(commentId: string) {
    startTransition(async () => {
      const result = await updateCommentAction(workspaceSlug, { commentId, body: editDraft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function onDelete(commentId: string) {
    if (!confirm('Delete this comment?')) return;
    startTransition(async () => {
      const result = await deleteCommentAction(workspaceSlug, { commentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 border-t border-stroke-soft-200 pt-4">
      <h3 className="text-label-sm text-text-strong-950">Activity</h3>

      <ol className="flex flex-col gap-3">
        {feed.map((entry) =>
          entry.type === 'activity' ? (
            <li key={entry.id} className="text-paragraph-sm text-text-sub-600">
              <span className="text-label-sm text-text-strong-950">{entry.actorName}</span>{' '}
              {describeActivity(entry)}
              <span className="ml-2 text-paragraph-xs text-text-soft-400">
                {formatInZone(entry.createdAt, timezone)}
              </span>
            </li>
          ) : (
            <li key={entry.id} className="flex gap-3">
              <Avatar.Root size="24" color="blue" aria-hidden="true" className="mt-0.5 shrink-0">
                {entry.authorName.slice(0, 1)}
              </Avatar.Root>
              <div className="min-w-0 flex-1 rounded-10 bg-bg-weak-50 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-label-sm text-text-strong-950">{entry.authorName}</span>
                  <span className="text-paragraph-xs text-text-soft-400">
                    {formatInZone(entry.createdAt, timezone)}
                    {entry.editedAt && ' (edited)'}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {entry.authorId === currentUserId && editingId !== entry.id && (
                      <Button.Root type="button" variant="neutral" mode="ghost" size="xxsmall" onClick={() => startEdit(entry)}>
                        Edit
                      </Button.Root>
                    )}
                    {(entry.authorId === currentUserId || canModerate) && (
                      <CompactButton.Root
                        type="button"
                        variant="ghost"
                        size="medium"
                        aria-label={`Delete comment by ${entry.authorName}`}
                        onClick={() => onDelete(entry.id)}
                        className="hover:text-error-base"
                      >
                        <CompactButton.Icon as={IconTrash} />
                      </CompactButton.Root>
                    )}
                  </span>
                </div>

                {editingId === entry.id ? (
                  <form
                    onSubmit={(event) => { event.preventDefault(); onEdit(entry.id); }}
                    className="mt-2 flex flex-col gap-2"
                  >
                    <RichTextField value={entry.body} label="Edit comment" onChange={setEditDraft} />
                    <div className="flex gap-2">
                      <Button.Root type="submit" size="xxsmall" disabled={pending}>Save</Button.Root>
                      <Button.Root type="button" variant="neutral" mode="stroke" size="xxsmall" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button.Root>
                    </div>
                  </form>
                ) : (
                  <Markdown className="mt-1">{entry.body}</Markdown>
                )}
              </div>
            </li>
          ),
        )}
      </ol>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <RichTextField
          key={composerKey}
          value=""
          label="Comment"
          placeholder="Write a comment… Markdown and / commands work."
          onChange={setDraft}
        />
        <div>
          <Button.Root type="submit" size="small" disabled={pending}>
            Comment
          </Button.Root>
        </div>
      </form>
    </section>
  );
}
