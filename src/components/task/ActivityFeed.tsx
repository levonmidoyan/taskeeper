'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { formatInZone } from '@/lib/dates';
import {
  createCommentAction, deleteCommentAction, updateCommentAction,
} from '@/server/comments/actions';
import type { FeedEntry } from '@/server/activity/queries';

/** The one place an activity row turns into a sentence. */
function describeActivity(entry: Extract<FeedEntry, { type: 'activity' }>): string {
  switch (entry.kind) {
    case 'created':
      return 'created this task';
    case 'title':
      return `renamed it from “${entry.from}” to “${entry.to}”`;
    case 'status':
      return `moved it from ${entry.from} to ${entry.to}`;
    case 'priority':
      return `changed priority from ${entry.from} to ${entry.to}`;
    case 'assignee':
      return entry.to ? `assigned it to ${entry.to}` : `unassigned ${entry.from}`;
    case 'due_date':
      return entry.to ? `set the due date to ${entry.to}` : 'cleared the due date';
  }
}

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = inputRef.current?.value ?? '';
    if (!body.trim() || pending) return;

    startTransition(async () => {
      const result = await createCommentAction(workspaceSlug, { taskId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    });
  }

  function onEdit(commentId: string, body: string) {
    startTransition(async () => {
      const result = await updateCommentAction(workspaceSlug, { commentId, body });
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
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-medium text-foreground">Activity</h3>

      <ol className="mt-3 space-y-3">
        {feed.map((entry) =>
          entry.type === 'activity' ? (
            <li key={entry.id} className="text-sm text-muted-foreground">
              <span className="text-foreground">{entry.actorName}</span>{' '}
              {describeActivity(entry)}
              <span className="ml-2 text-xs">{formatInZone(entry.createdAt, timezone)}</span>
            </li>
          ) : (
            <li key={entry.id} className="rounded-md bg-muted/40 p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-foreground">{entry.authorName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatInZone(entry.createdAt, timezone)}
                  {entry.editedAt && ' (edited)'}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {entry.authorId === currentUserId && editingId !== entry.id && (
                    <button
                      type="button"
                      onClick={() => setEditingId(entry.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit
                    </button>
                  )}
                  {(entry.authorId === currentUserId || canModerate) && (
                    <button
                      type="button"
                      aria-label={`Delete comment by ${entry.authorName}`}
                      onClick={() => onDelete(entry.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </span>
              </div>

              {editingId === entry.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('body');
                    onEdit(entry.id, String(value ?? ''));
                  }}
                  className="mt-2"
                >
                  <textarea
                    name="body"
                    defaultValue={entry.body}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="submit" disabled={pending} className="text-xs text-foreground">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                // Plain text in v1 (rich text is the next roadmap slice), so
                // whitespace is preserved rather than parsed.
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.body}</p>
              )}
            </li>
          ),
        )}
      </ol>

      <form onSubmit={onSubmit} className="mt-4">
        <label htmlFor="new-comment" className="sr-only">
          Comment
        </label>
        <textarea
          id="new-comment"
          ref={inputRef}
          rows={3}
          placeholder="Write a comment…"
          className="w-full rounded-md border border-input bg-background p-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-60"
        >
          Comment
        </button>
      </form>
    </section>
  );
}
