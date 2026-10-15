import { dropTarget } from '@/lib/todo-list';

/** The most subtasks one paste or batch call may create. */
export const MAX_SUBTASK_BATCH = 50;

const LIST_MARKER = /^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/;

/** A pasted block as subtask titles: one per non-blank line, list markers dropped. */
export function splitPastedLines(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim().replace(LIST_MARKER, '').trim())
    .filter((line) => line.length > 0);
}

/** Move one place up or down: the same neighbour contract as a drag. Null at an end. */
export function stepTarget(ids: string[], id: string, delta: -1 | 1) {
  const from = ids.indexOf(id);
  const over = ids[from + delta];
  if (from === -1 || over === undefined) return null;
  return dropTarget(ids, id, over);
}

export function progressPercent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
