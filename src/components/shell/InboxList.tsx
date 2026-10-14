'use client';

import { useRouter } from 'next/navigation';
import { addTransitionType, startTransition, useState } from 'react';
import { toast } from 'sonner';
import { BELL_CHANGE } from '@/lib/motion';
import { settle } from '@/lib/settle';
import {
  clearAllNotificationsAction, clearNotificationAction, markAllNotificationsReadAction, markNotificationReadAction,
} from '@/server/notifications/actions';
import type { NotificationItem } from '@/server/notifications/queries';
import { NotificationList } from './NotificationList';

/**
 * The bell's list as a page, for phones. Same actions as the bell; each one
 * refreshes the route after it lands so the header and bottom-bar badges follow.
 */
export function InboxList({ workspaceSlug, initialItems }: { workspaceSlug: string; initialItems: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const unread = items.some((i) => !i.readAt);

  async function markOne(item: NotificationItem) {
    if (item.readAt) return;
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, readAt: new Date() } : i)));
    const result = await settle(markNotificationReadAction(workspaceSlug, item.id));
    if (result.ok) router.refresh();
  }

  async function markAll() {
    const result = await settle(markAllNotificationsReadAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })));
    router.refresh();
  }

  async function clearOne(item: NotificationItem) {
    startTransition(() => {
      addTransitionType(BELL_CHANGE);
      setItems((list) => list.filter((i) => i.id !== item.id));
    });
    const result = await settle(clearNotificationAction(workspaceSlug, item.id));
    if (!result.ok) return toast.error(result.error);
    router.refresh();
  }

  async function clearAll() {
    const result = await settle(clearAllNotificationsAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    startTransition(() => {
      addTransitionType(BELL_CHANGE);
      setItems([]);
    });
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title-h5 text-text-strong-950">Inbox</h1>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={markAll}
            disabled={!unread}
            className="min-h-11 text-label-sm text-primary-base disabled:text-text-disabled-300"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={items.length === 0}
            className="min-h-11 text-label-sm text-text-sub-600 hover:text-text-strong-950 disabled:text-text-disabled-300"
          >
            Clear all
          </button>
        </div>
      </div>
      <NotificationList
        workspaceSlug={workspaceSlug}
        items={items}
        onOpen={markOne}
        onClear={clearOne}
        className="mt-4 rounded-2xl bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200"
      />
    </>
  );
}
