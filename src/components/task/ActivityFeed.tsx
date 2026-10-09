'use client';

import { IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ShortcutKeys } from '@/components/shell/ShortcutHint';
import { CollapsibleSection } from '@/components/task/CollapsibleSection';
import { CommentReactions } from '@/components/task/CommentReactions';
import { Markdown } from '@/components/task/Markdown';
import { RichTextField } from '@/components/task/RichTextField';
import { UserAvatar } from '@/components/auth/user/user-avatar';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import * as SegmentedControl from '@/components/ui/segmented-control';
import { useTaskSectionOpen } from '@/hooks/use-task-sections';
import { describeActivity } from '@/lib/activity-text';
import { formatInZone } from '@/lib/dates';
import { settle } from '@/lib/settle';
import { useShortcut } from '@/lib/shortcuts/provider';
import { cn } from '@/utils/cn';
import type { FeedEntry } from '@/server/activity/queries';
import type { MemberRow } from '@/server/labels/queries';
import {
  createCommentAction, deleteCommentAction, updateCommentAction,
} from '@/server/comments/actions';

type ActivityTab = 'all' | 'comments' | 'history';

const TABS: { value: ActivityTab; label: string; empty: string }[] = [
  { value: 'all', label: 'All', empty: 'No activity yet.' },
  { value: 'comments', label: 'Comments', empty: 'No comments yet.' },
  { value: 'history', label: 'History', empty: 'No changes yet.' },
];

const QUICK_REPLIES = ['Looks good!', 'Need help?', 'This is blocked…', 'Can you clarify…?'];

export function ActivityFeed({
  taskId,
  feed,
  members,
  workspaceSlug,
  currentUserId,
  canModerate,
  timezone,
}: {
  taskId: string;
  feed: FeedEntry[];
  /** Offered by the @ menu, and the names mention chips show. */
  members: MemberRow[];
  workspaceSlug: string;
  currentUserId: string;
  canModerate: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  // What the composer opens with: empty, or a quick reply to carry on from.
  const [seed, setSeed] = useState('');
  // Bumped to clear or reseed the composer: remounting the editor is how it is reset.
  const [composerKey, setComposerKey] = useState(0);
  const [focused, setFocused] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [tab, setTab] = useState<ActivityTab>('comments');
  const composerRef = useRef<HTMLFormElement>(null);
  const [, setSectionOpen] = useTaskSectionOpen('activity');
  // m: open the section if collapsed, leave History, and put the caret in the composer.
  useShortcut('detail.comment', () => {
    setSectionOpen(true);
    setTab((t) => (t === 'history' ? 'comments' : t));
    requestAnimationFrame(() =>
      composerRef.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus());
  });

  // Jira-style filter over the one merged feed: comments, field history, or both.
  // Newest first, so what I just posted lands right under the composer.
  const visible = (tab === 'all'
    ? feed
    : feed.filter((entry) => entry.type === (tab === 'comments' ? 'comment' : 'activity'))
  ).toReversed();

  // Jira's composer: a one-line prompt until focused, then the editor with Save
  // and Cancel. A half-written comment keeps it open after focus leaves.
  const expanded = focused || draft.trim() !== '';

  function resetComposer() {
    setDraft('');
    setSeed('');
    setFocused(false);
    setComposerKey((k) => k + 1);
  }

  function startWith(text: string) {
    setSeed(text);
    setDraft(text);
    setComposerKey((k) => k + 1);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft;
    if (!body.trim() || pending) return;

    startTransition(async () => {
      const result = await settle(createCommentAction(workspaceSlug, { taskId, body }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      resetComposer();
      router.refresh();
    });
  }

  function startEdit(entry: { id: string; body: string }) {
    setEditDraft(entry.body);
    setEditingId(entry.id);
  }

  function onEdit(commentId: string) {
    startTransition(async () => {
      const result = await settle(updateCommentAction(workspaceSlug, { commentId, body: editDraft }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  async function onDelete(commentId: string) {
    if (!(await confirm({ title: 'Delete this comment?', description: 'This can’t be undone.' }))) return;
    startTransition(async () => {
      const result = await settle(deleteCommentAction(workspaceSlug, { commentId }));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <CollapsibleSection
      sectionId="activity"
      title="Activity"
      actions={(
        <SegmentedControl.Root value={tab} onValueChange={(value) => setTab(value as ActivityTab)}>
          <SegmentedControl.List aria-label="Show activity" className="w-auto">
            {TABS.map(({ value, label }) => (
              <SegmentedControl.Trigger key={value} value={value} className="px-3">
                {label}
              </SegmentedControl.Trigger>
            ))}
          </SegmentedControl.List>
        </SegmentedControl.Root>
      )}
    >
      {/* On top and pinned while the feed scrolls under it, Jira-style. It sticks
          above the edge by the column's padding and fills that band with its own
          background, so the feed never peeks out over it. Hidden, not unmounted, on
          History so a half-written comment survives a tab switch. */}
      <form
        ref={composerRef}
        onSubmit={onSubmit}
        hidden={tab === 'history'}
        onFocus={(event) => {
          // Only the editor opens it: a focused quick reply would swap itself out
          // for Save and Cancel on mousedown, before its click lands.
          if ((event.target as Element).closest('[role="textbox"]')) setFocused(true);
        }}
        onBlur={(event) => {
          // Moving between the editor and its own buttons is not leaving the composer.
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
        onKeyDownCapture={(event) => {
          // Ahead of the editor, whose own Mod-Enter would add a line break first.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.requestSubmit();
          }
        }}
        className="sticky -top-5 z-10 -mt-2 flex gap-3 bg-bg-white-0 pt-5 pb-3"
      >
        <UserAvatar aria-hidden="true" className="size-8 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* The whole box takes the click, not just the line of text inside its padding;
              the textbox itself is the keyboard's way in. */}
          <div onClick={(event) => event.currentTarget.querySelector<HTMLElement>('[role="textbox"]')?.focus()}>
            <RichTextField
              key={composerKey}
              value={seed}
              label="Comment"
              members={members}
              placeholder="Add a comment… Markdown and / commands work."
              autoFocus={seed !== ''}
              onChange={setDraft}
              // A one-line box until it is used; room to write once it is.
              className={cn(!expanded && 'cursor-text hover:bg-bg-weak-50 [&_.md-content]:min-h-5')}
            />
          </div>
          {expanded ? (
            <div className="flex items-center gap-2">
              <Button.Root type="submit" size="xxsmall" disabled={pending || !draft.trim()}>
                Save
              </Button.Root>
              <Button.Root type="button" variant="neutral" mode="ghost" size="xxsmall" onClick={resetComposer}>
                Cancel
              </Button.Root>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REPLIES.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => startWith(text)}
                  className="rounded-full px-2.5 py-0.5 text-paragraph-xs text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200 transition-colors duration-150 hover:bg-bg-weak-50 hover:text-text-strong-950"
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          {!expanded && (
            <p className="flex items-center gap-1 text-paragraph-xs text-text-soft-400">
              <span className="text-label-xs text-text-sub-600">Pro tip:</span> press
              <ShortcutKeys id="detail.comment" /> to comment
            </p>
          )}
        </div>
      </form>

      {visible.length === 0 && (
        <p className="text-paragraph-sm text-text-soft-400">
          {TABS.find((t) => t.value === tab)!.empty}
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {visible.map((entry) =>
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
              <UserAvatar
                user={{ name: entry.authorName, image: entry.authorImage }}
                aria-hidden="true"
                className="mt-0.5 size-6 text-[0.625rem]"
              />
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
                    <RichTextField value={entry.body} label="Edit comment" members={members} onChange={setEditDraft} />
                    <div className="flex gap-2">
                      <Button.Root type="submit" size="xxsmall" disabled={pending}>Save</Button.Root>
                      <Button.Root type="button" variant="neutral" mode="stroke" size="xxsmall" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button.Root>
                    </div>
                  </form>
                ) : (
                  <>
                    <Markdown className="mt-1" members={members} currentUserId={currentUserId}>{entry.body}</Markdown>
                    <CommentReactions
                      workspaceSlug={workspaceSlug}
                      commentId={entry.id}
                      reactions={entry.reactions}
                      currentUserId={currentUserId}
                    />
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ol>
    </CollapsibleSection>
  );
}
