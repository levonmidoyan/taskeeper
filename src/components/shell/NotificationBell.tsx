'use client';

import { IconBell } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addTransitionType, startTransition, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import { playChime } from '@/lib/chime';
import { BELL_CHANGE } from '@/lib/motion';
import { bellHref, bellText, MAX_TOASTS, pickToasts } from '@/lib/notifications';
import { settle } from '@/lib/settle';
import {
  clearAllNotificationsAction, clearNotificationAction, listNotificationsAction, markAllNotificationsReadAction,
  markNotificationReadAction, unreadCountAction,
} from '@/server/notifications/actions';
import type { NotificationItem } from '@/server/notifications/queries';
import { NotificationList } from './NotificationList';
import { cn } from '@/utils/cn';
import { Hint } from '@/components/shell/ShortcutHint';

/**
 * Header bell. The count arrives server-rendered with the shell and is
 * re-fetched when the window regains focus; the list loads when opened.
 * When the count rises (a live refresh or the focus re-count), new change items
 * also pop up as toasts, with one chime per batch when the user keeps sound on.
 */
export function NotificationBell({ workspaceSlug, initialUnread, serverNow, sound }: {
  workspaceSlug: string;
  initialUnread: number;
  /** The database clock when the shell rendered: the toast cutoff starts here, not at the browser's clock. */
  serverNow: number;
  /** Chime with new toasts (the user's change-sound setting). */
  sound: boolean;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Only what arrives after this tab opened toasts; the count it opened with
  // does not. A fixed cutoff plus what already toasted, not the newest toast's
  // time: a row from a transaction that committed late can be older than that.
  const since = useRef(serverNow);
  const toasted = useRef(new Set<string>());
  const seenUnread = useRef(initialUnread);
  // Marked read here, so a toast's Open and the list cannot both count one item.
  const markedRead = useRef(new Set<string>());

  // A fresh server count (navigation, revalidation) replaces the local one.
  const [serverUnread, setServerUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(initialUnread);
  }

  // A rising count pops the badge. Adjusted during render (like serverUnread above),
  // so the first render and falling counts do not animate.
  const [pop, setPop] = useState(0);
  const [shownUnread, setShownUnread] = useState(unread);
  if (shownUnread !== unread) {
    if (unread > shownUnread) setPop((n) => n + 1);
    setShownUnread(unread);
  }

  useEffect(() => {
    const onFocus = async () => {
      const result = await settle(unreadCountAction(workspaceSlug));
      if (result.ok) setUnread(result.data);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [workspaceSlug]);

  useEffect(() => {
    const rose = unread > seenUnread.current;
    seenUnread.current = unread;
    if (!rose) return;
    let cancelled = false;
    void (async () => {
      const result = await settle(listNotificationsAction(workspaceSlug));
      if (cancelled || !result.ok) return;
      setItems(result.data);
      // A merge restamps created_at, so an item toasts again for each new change.
      const key = (item: NotificationItem) => `${item.id}@${new Date(item.createdAt).getTime()}`;
      const fresh = pickToasts(result.data, since.current).filter((item) => !toasted.current.has(key(item)));
      if (fresh.length === 0) return;
      for (const item of fresh) toasted.current.add(key(item));
      if (sound) playChime();
      if (fresh.length > MAX_TOASTS) {
        toast(`${fresh.length} new updates`, { action: { label: 'View', onClick: () => setOpen(true) } });
        return;
      }
      for (const item of fresh) {
        const { title, detail } = bellText(item);
        toast(title, {
          description: detail,
          action: {
            label: 'Open',
            onClick: () => {
              markRead(item.id);
              router.push(bellHref(workspaceSlug, item));
            },
          },
        });
      }
    })();
    return () => { cancelled = true; };
    // markRead only touches refs and state setters. `sound` is read when the
    // count rises; as a dep, flipping it would cancel an in-flight batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, workspaceSlug, router]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    const result = await settle(listNotificationsAction(workspaceSlug));
    if (result.ok) setItems(result.data);
    else toast.error(result.error);
  }

  function markRead(id: string) {
    if (markedRead.current.has(id)) return;
    markedRead.current.add(id);
    setUnread((n) => Math.max(0, n - 1));
    setItems((list) => list?.map((i) => (i.id === id ? { ...i, readAt: i.readAt ?? new Date() } : i)) ?? null);
    void settle(markNotificationReadAction(workspaceSlug, id));
  }

  function markOne(item: NotificationItem) {
    setOpen(false);
    if (!item.readAt) markRead(item.id);
  }

  async function markAll() {
    const result = await settle(markAllNotificationsReadAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    setUnread(0);
    setItems((list) => list?.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })) ?? null);
  }

  async function clearOne(item: NotificationItem) {
    // Clearing reads too: counted here, so a toast's Open cannot count it again.
    const wasUnread = !item.readAt && !markedRead.current.has(item.id);
    markedRead.current.add(item.id);
    if (wasUnread) setUnread((n) => Math.max(0, n - 1));
    startTransition(() => {
      addTransitionType(BELL_CHANGE);
      setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
    });
    const result = await settle(clearNotificationAction(workspaceSlug, item.id));
    if (!result.ok) toast.error(result.error);
  }

  async function clearAll() {
    const result = await settle(clearAllNotificationsAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    setUnread(0);
    startTransition(() => {
      addTransitionType(BELL_CHANGE);
      setItems([]);
    });
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  const badge = unread > 0 && (
    <span
      key={pop}
      aria-hidden="true"
      className={cn(
        'tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-base px-1 text-[0.625rem] font-medium text-static-white',
        pop > 0 && 'animate-badge-pop',
      )}
    >
      {unread > 9 ? '9+' : unread}
    </span>
  );

  return (
    <>
      {/* Phones get the full Inbox page instead of a popover. */}
      <Hint label="Notifications">
        <CompactButton.Root asChild variant="ghost" size="large" className="relative sm:hidden">
          <Link href={`/${workspaceSlug}/inbox`} aria-label={label}>
            <CompactButton.Icon as={IconBell} />
            {badge}
          </Link>
        </CompactButton.Root>
      </Hint>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>
          <Hint label="Notifications">
            <CompactButton.Root variant="ghost" size="large" aria-label={label} className="relative max-sm:hidden">
              <CompactButton.Icon as={IconBell} />
              {badge}
            </CompactButton.Root>
          </Hint>
        </Popover.Trigger>
        <Popover.Content align="end" sideOffset={8} showArrow={false} className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-stroke-soft-200 px-4 py-3">
            <span className="text-label-sm text-text-strong-950">Notifications</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={markAll}
                disabled={unread === 0}
                className="text-label-xs text-primary-base disabled:text-text-disabled-300"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={!items?.length}
                className="text-label-xs text-text-sub-600 hover:text-text-strong-950 disabled:text-text-disabled-300"
              >
                Clear all
              </button>
            </div>
          </div>
          <NotificationList workspaceSlug={workspaceSlug} items={items} onOpen={markOne} onClear={clearOne} className="max-h-96 overflow-y-auto" />
        </Popover.Content>
      </Popover.Root>
    </>
  );
}
