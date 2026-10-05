import type { WorkspaceSummary } from '@/server/workspaces/queries';
import type { MemberRow } from '@/server/labels/queries';
import type { LabelRow } from '@/server/tasks/queries';
import { appUrl } from '@/lib/url';
import type { FeedEntry } from '@/server/activity/queries';
import type { ApiComment, ApiLabel, ApiMember, ApiProject, ApiStatus, ApiTask, ApiTaskSummary, ApiWorkspace } from './contract/shapes';
import type { ApiTaskSource } from './queries';

/**
 * Internal rows → the public contract. Nothing else may put a row into a
 * response, so the UI can change its queries without breaking API clients.
 */

export function serializeWorkspace(w: WorkspaceSummary): ApiWorkspace {
  return { slug: w.slug, name: w.name, role: w.role };
}

export function serializeProject(p: { id: string; name: string; slug: string; color: string; openTaskCount: number }): ApiProject {
  return { id: p.id, name: p.name, slug: p.slug, color: p.color, openTaskCount: Number(p.openTaskCount) };
}

export function serializeStatus(s: { id: string; name: string; isDone: boolean }): ApiStatus {
  return { id: s.id, name: s.name, isDone: s.isDone };
}

export function serializeLabel(l: LabelRow): ApiLabel {
  return { id: l.id, name: l.name, color: l.color };
}

export function serializeMember(m: MemberRow): ApiMember {
  return { id: m.userId, name: m.name, email: m.email, role: m.role };
}

export function serializeTaskSummary(slug: string, t: ApiTaskSource): ApiTaskSummary {
  return {
    id: t.id,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId,
    title: t.title,
    status: { id: t.statusId, name: t.statusName, isDone: t.isDone },
    priority: t.priority,
    assignee: t.assigneeId ? { id: t.assigneeId, name: t.assigneeName ?? 'Deleted user' } : null,
    dueDate: t.dueDate,
    labels: t.labels,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    url: `${appUrl()}/${slug}/tasks/${t.id}`,
  };
}

export function serializeTask(slug: string, t: ApiTaskSource & { description: string }): ApiTask {
  return { ...serializeTaskSummary(slug, t), description: t.description };
}

export function serializeComment(c: Extract<FeedEntry, { type: 'comment' }>): ApiComment {
  return {
    id: c.id,
    // The feed names a deleted author "Deleted user"; the API says null instead.
    author: c.authorId ? { id: c.authorId, name: c.authorName } : null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
  };
}
