/**
 * Change notifications: payload types, bell copy and links for every kind, and
 * which items toast. Pure, so the bell, the server and tests share it.
 */

import {
  notificationHref, notificationText, type DigestData, type NotificationData, type ReminderData,
} from './reminders';

export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment', 'reaction',
] as const;
export type TaskChangeKind = (typeof TASK_CHANGE_KINDS)[number];

export type TaskChangeData = {
  /** Task title as of the latest merged change. */
  title: string;
  projectName: string;
  actorName: string;
  /** Deduped, in order of first occurrence. */
  changes: TaskChangeKind[];
  /** The latest assignee change made the recipient the assignee. */
  assignedToYou?: true;
  /** Latest new status name, when 'status' is among changes. */
  status?: string;
  /** Latest comment excerpt, when 'comment' is among changes. */
  comment?: string;
  /** Latest reaction and the excerpt of the comment it is on, when 'reaction' is among changes. */
  reaction?: { emoji: string; comment: string };
};

export const PROJECT_CHANGE_KINDS = ['renamed', 'archived', 'unarchived', 'deleted'] as const;
export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number];

export type ProjectChangeData = {
  /** Name before the first merged change. */
  projectName: string;
  /** Latest name, when 'renamed' is among changes. */
  newName?: string;
  actorName: string;
  /** At most one of archived / unarchived: the latest, so the project's state now. */
  changes: ProjectChangeKind[];
};

export type BellKind = 'reminder' | 'digest' | 'task_change' | 'project_change';
export type BellItem = { kind: BellKind; taskId: string | null; projectId: string | null; data: NotificationData };

export const MAX_TOASTS = 3;

const FIELD_LABELS: Record<TaskChangeKind, string> = {
  title: 'title', description: 'description', status: 'status', priority: 'priority', assignee: 'assignee',
  due_date: 'due date', labels: 'labels', attachment: 'attachments', comment: 'comment',
  reaction: 'reaction',
};

const PROJECT_VERBS: Record<ProjectChangeKind, string> = {
  renamed: 'renamed', archived: 'archived', unarchived: 'restored', deleted: 'deleted',
};

function taskDetail(d: TaskChangeData): string {
  const only = d.changes.length === 1 ? d.changes[0] : null;
  if (d.assignedToYou) return `${d.actorName} assigned you`;
  if (only === 'comment' && d.comment) return `${d.actorName} commented: “${d.comment}”`;
  if (only === 'reaction' && d.reaction) {
    return `${d.actorName} reacted ${d.reaction.emoji} to your comment: “${d.reaction.comment}”`;
  }
  if (only === 'status' && d.status) return `${d.actorName} moved to ${d.status}`;
  return `${d.actorName} changed ${d.changes.map((k) => FIELD_LABELS[k]).join(', ')}`;
}

function projectDetail(d: ProjectChangeData): string {
  if (d.changes.length > 1) return `${d.actorName} ${d.changes.map((k) => PROJECT_VERBS[k]).join(', ')}`;
  const [only] = d.changes;
  if (only === 'renamed') return `${d.actorName} renamed to ${d.newName ?? d.projectName}`;
  return `${d.actorName} ${PROJECT_VERBS[only]} this project`;
}

export function bellText(item: BellItem): { title: string; detail: string } {
  if (item.kind === 'task_change') {
    const d = item.data as TaskChangeData;
    return { title: d.title, detail: taskDetail(d) };
  }
  if (item.kind === 'project_change') {
    const d = item.data as ProjectChangeData;
    return { title: d.projectName, detail: projectDetail(d) };
  }
  return notificationText({ kind: item.kind, data: item.data as ReminderData | DigestData });
}

export function bellHref(slug: string, item: BellItem): string {
  if (item.kind === 'task_change') return item.taskId ? `/${slug}/tasks/${item.taskId}` : `/${slug}`;
  if (item.kind === 'project_change') {
    const d = item.data as ProjectChangeData;
    if (!item.projectId || d.changes.includes('deleted')) return `/${slug}`;
    if (d.changes.includes('archived')) return `/${slug}/settings/projects`;
    return `/${slug}/projects/${item.projectId}`;
  }
  return notificationHref(slug, { kind: item.kind, taskId: item.taskId });
}

const ms = (d: Date | string) => new Date(d).getTime();

/** Unread change items created after `since` (epoch ms), newest first. Reminders and digests never toast. */
export function pickToasts<T extends { kind: BellKind; readAt: Date | string | null; createdAt: Date | string }>(
  items: T[],
  since: number,
): T[] {
  return items
    .filter((i) => (i.kind === 'task_change' || i.kind === 'project_change') && !i.readAt && ms(i.createdAt) > since)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
}
