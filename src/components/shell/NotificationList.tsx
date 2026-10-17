'use client';

import { IconX } from '@tabler/icons-react';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { BELL_CHANGE_CLASSES, BELL_EMPTY_CLASSES, bellTransitionName } from '@/lib/motion';
import { bellHref, bellText } from '@/lib/notifications';
import type { NotificationItem } from '@/server/notifications/queries';
import { cn } from '@/utils/cn';
import { Hint } from '@/components/shell/ShortcutHint';

/** The bell's rows, shared by its popover and the Inbox page. */
export function NotificationList({ workspaceSlug, items, onOpen, onClear, className }: {
  workspaceSlug: string;
  items: NotificationItem[] | null;
  onOpen: (item: NotificationItem) => void;
  onClear: (item: NotificationItem) => void;
  className?: string;
}) {
  return (
    <ul className={cn('p-1', className)} aria-label="Notifications">
      {items === null && <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Loading…</li>}
      {items?.length === 0 && (
        <ViewTransition {...BELL_EMPTY_CLASSES}>
          <li className="px-3 py-6 text-center text-paragraph-sm text-text-sub-600">Nothing yet.</li>
        </ViewTransition>
      )}
      {items?.map((item) => {
        const { title, detail } = bellText(item);
        return (
          <ViewTransition key={item.id} name={bellTransitionName(item.id)} {...BELL_CHANGE_CLASSES}>
            <li className="group relative">
              <Link
                href={bellHref(workspaceSlug, item)}
                onClick={() => onOpen(item)}
                className="flex items-start gap-2 rounded-lg p-2 pr-8 hover:bg-bg-weak-50"
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
              <Hint label="Clear">
                <button
                  type="button"
                  onClick={() => onClear(item)}
                  aria-label={`Clear notification: ${title}`}
                  className="absolute right-1.5 top-2 flex size-5 items-center justify-center rounded-md text-text-soft-400 opacity-0 hover:bg-bg-soft-200 hover:text-text-strong-950 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <IconX className="size-3.5" aria-hidden="true" />
                </button>
              </Hint>
            </li>
          </ViewTransition>
        );
      })}
    </ul>
  );
}
