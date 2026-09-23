import type { FeedEntry } from '@/server/activity/queries';

/**
 * The one place an activity row turns into a sentence. A plain module rather
 * than staying inside ActivityFeed's 'use client' component so it can be unit
 * tested without dragging in React, next/navigation, or server actions.
 */
export function describeActivity(entry: Extract<FeedEntry, { type: 'activity' }>): string {
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
      // entry.from can be null even when unassigning: the previous assignee may
      // have left the workspace, or the stored id may never have resolved to a
      // name in this workspace, so there is no name to report.
      return entry.to ? `assigned it to ${entry.to}` : entry.from ? `unassigned ${entry.from}` : 'unassigned it';
    case 'due_date':
      return entry.to ? `set the due date to ${entry.to}` : 'cleared the due date';
  }
}
