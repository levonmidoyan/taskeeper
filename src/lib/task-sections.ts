/** The collapsible sections of a task's detail view. */
export type TaskSectionId = 'description' | 'subtasks' | 'attachments' | 'activity';

/** Which sections are collapsed. Absent means open: every section starts expanded. */
export type CollapsedSections = Partial<Record<TaskSectionId, true>>;

export const TASK_SECTIONS_KEY = 'taskeeper:task-sections';

const IDS: readonly TaskSectionId[] = ['description', 'subtasks', 'attachments', 'activity'];

/** Reads the stored value, dropping anything it does not recognise. */
export function parseCollapsedSections(raw: string | null): CollapsedSections {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: CollapsedSections = {};
  for (const id of IDS) {
    if ((data as Record<string, unknown>)[id] === true) out[id] = true;
  }
  return out;
}

export function withSectionOpen(
  collapsed: CollapsedSections,
  id: TaskSectionId,
  open: boolean,
): CollapsedSections {
  const next = { ...collapsed };
  if (open) delete next[id];
  else next[id] = true;
  return next;
}
