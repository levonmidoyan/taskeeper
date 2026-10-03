'use client';

import { IconBell } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import { notificationHref, notificationText } from '@/lib/reminders';
import { settle } from '@/lib/settle';
import {
  listNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, unreadCountAction,
} from '@/server/notifications/actions';
import type { NotificationItem } from '@/server/notifications/queries';
import { cn } from '@/utils/cn';

/**
 * Header bell. The count arrives server-rendered with the shell and is
 * re-fetched when the window regains focus; the list loads when opened.
 * No realtime (roadmap slice 8).
 */
export function NotificationBell({ workspaceSlug, initialUnread }: { workspaceSlug: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);

  // A fresh server count (navigation, revalidation) replaces the local one.
  const [serverUnread, setServerUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(initialUnread);
  }

  useEffect(() => {
    const onFocus = async () => {
      const result = await settle(unreadCountAction(workspaceSlug));
      if (result.ok) setUnread(result.data);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [workspaceSlug]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    const result = await settle(listNotificationsAction(workspaceSlug));
    if (result.ok) setItems(result.data);
    else toast.error(result.error);
  }

  function markOne(item: NotificationItem) {
    setOpen(false);
    if (item.readAt) return;
    setUnread((n) => Math.max(0, n - 1));
    void settle(markNotificationReadAction(workspaceSlug, item.id));
  }

  async function markAll() {
    const result = await settle(markAllNotificationsReadAction(workspaceSlug));
    if (!result.ok) return toast.error(result.error);
    setUnread(0);
    setItems((list) => list?.map((i) => ({ ...i, readAt: i.readAt ?? new Date() })) ?? null);
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <CompactButton.Root variant="ghost" size="large" aria-label={label} className="relative">
          <CompactButton.Icon as={IconBell} />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-base px-1 text-[0.625rem] font-medium text-static-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </CompactButton.Root>
      </Popover.Trigger>
      <Popover.Content align="end" sideOffset={8} showArrow={false} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-stroke-soft-200 px-4 py-3">
          <span className="text-label-sm text-text-strong-950">Notifications</span>
          <button
            type="button"
            onClick={markAll}
            disabled={unread === 0}
            className="text-label-xs text-primary-base disabled:text-text-disabled-300"
          >
            Mark all read
          </button>
        </div>
        <ul className="max-h-96 overflow-y-auto p-1" aria-label="Notifications">
          {items === null && <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Loading…</li>}
          {items?.length === 0 && (
            <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Nothing yet.</li>
          )}
          {items?.map((item) => {
            const { title, detail } = notificationText(item);
            return (
              <li key={item.id}>
                <Link
                  href={notificationHref(workspaceSlug, item)}
                  onClick={() => markOne(item)}
                  className="flex items-start gap-2 rounded-lg p-2 hover:bg-bg-weak-50"
                >
                  <span
                    aria-hidden="true"
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-primary-base')}
                  />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-label-sm', item.readAt ? 'text-text-sub-600' : 'text-text-strong-950')}>
                      {title}
                    </span>
                    <span className="block truncate text-paragraph-xs text-text-sub-600">{detail}</span>
                  </span>
                  {!item.readAt && <span className="sr-only">Unread</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </Popover.Content>
    </Popover.Root>
  );
}
