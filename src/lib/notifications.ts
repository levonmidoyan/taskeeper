/**
 * Change notifications: payload types, bell copy and links for every kind, and
 * which items toast. Pure, so the bell, the server and tests share it.
 */

export const TASK_CHANGE_KINDS = [
  'title', 'description', 'status', 'priority', 'assignee', 'due_date',
  'labels', 'attachment', 'comment',
] as const;
export type TaskChangeKind = (typeof TASK_CHANGE_KINDS)[number];

export type TaskChangeData = {
  /** Task title as of the latest merged change. */
  title: string;
  projectName: string;
  actorName: string;
  /** Deduped, in order of first occurrence. */
  changes: TaskChangeKind[];
  /** The recipient became the assignee in one of the merged changes. */
  assignedToYou?: true;
  /** Latest new status name, when 'status' is among changes. */
  status?: string;
  /** Latest comment excerpt, when 'comment' is among changes. */
  comment?: string;
};

export const PROJECT_CHANGE_KINDS = ['renamed', 'archived', 'unarchived', 'deleted'] as const;
export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number];

export type ProjectChangeData = {
  /** Name before the first merged change. */
  projectName: string;
  /** Latest name, when 'renamed' is among changes. */
  newName?: string;
  actorName: string;
  changes: ProjectChangeKind[];
};
