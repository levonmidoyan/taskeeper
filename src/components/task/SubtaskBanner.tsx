'use client';

import { IconChevronLeft, IconChevronRight, IconSubtask } from '@tabler/icons-react';
import { Hint } from '@/components/shell/ShortcutHint';

export function SubtaskBanner({
  parentTitle, siblings, currentId, onGo, onParent,
}: {
  parentTitle: string;
  siblings: { id: string; title: string }[];
  currentId: string;
  onGo: (id: string) => void;
  onParent: () => void;
}) {
  const index = siblings.findIndex((s) => s.id === currentId);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-stroke-soft-200 bg-bg-weak-50 px-5 py-2 text-paragraph-xs text-text-sub-600">
      <span className="flex min-w-0 items-center gap-1.5">
        <IconSubtask className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Subtask of</span>
        <button
          type="button"
          onClick={onParent}
          className="truncate font-medium text-text-strong-950 hover:underline"
        >
          {parentTitle}
        </button>
      </span>
      {index >= 0 && siblings.length > 1 && (
        <span className="flex shrink-0 items-center gap-1">
          <Hint label="Previous subtask ( [ )">
            <button type="button" aria-label="Previous subtask" disabled={!prev} onClick={() => prev && onGo(prev.id)}
              className="inline-flex size-7 items-center justify-center rounded-md hover:bg-bg-soft-200 disabled:opacity-40">
              <IconChevronLeft className="size-4" aria-hidden="true" />
            </button>
          </Hint>
          <span className="tabular">{index + 1} of {siblings.length}</span>
          <Hint label="Next subtask ( ] )">
            <button type="button" aria-label="Next subtask" disabled={!next} onClick={() => next && onGo(next.id)}
              className="inline-flex size-7 items-center justify-center rounded-md hover:bg-bg-soft-200 disabled:opacity-40">
              <IconChevronRight className="size-4" aria-hidden="true" />
            </button>
          </Hint>
        </span>
      )}
    </div>
  );
}
