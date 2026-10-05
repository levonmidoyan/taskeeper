import type { WorkspaceSummary } from '@/server/workspaces/queries';
import type { MemberRow } from '@/server/labels/queries';
import type { LabelRow } from '@/server/tasks/queries';
import type { ApiLabel, ApiMember, ApiProject, ApiStatus, ApiWorkspace } from './contract/shapes';

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
