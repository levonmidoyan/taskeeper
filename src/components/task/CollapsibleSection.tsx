'use client';

import { IconChevronRight } from '@tabler/icons-react';
import { useId } from 'react';
import { useTaskSectionOpen } from '@/hooks/use-task-sections';
import type { TaskSectionId } from '@/lib/task-sections';
import { cn } from '@/utils/cn';

type CollapsibleSectionProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  /** Which section this is; its open state is remembered per browser under this. */
  sectionId: TaskSectionId;
  title: string;
  /** Shown beside the title, collapsed or not (a count, a done ratio). */
  meta?: React.ReactNode;
  /** Controls on the header's right, shown only while open. */
  actions?: React.ReactNode;
};

/**
 * One of the task view's sections, collapsible from its header, Jira-style.
 * Collapsed content is hidden, not unmounted, so a half-written comment or an
 * upload in flight survives.
 */
export function CollapsibleSection({
  sectionId, title, meta, actions, className, children, ...props
}: CollapsibleSectionProps) {
  const [open, setOpen] = useTaskSectionOpen(sectionId);
  const id = useId();
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-2', className)} {...props}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-label-sm text-text-strong-950">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-bg-weak-50"
          >
            <IconChevronRight
              aria-hidden="true"
              className={cn('size-4 text-text-sub-600 transition-transform duration-150', open && 'rotate-90')}
            />
            {title}
            {meta !== undefined && (
              <span className="tabular ml-1 text-paragraph-xs font-normal text-text-sub-600">{meta}</span>
            )}
          </button>
        </h2>
        {open && actions}
      </div>

      <div id={panelId} hidden={!open} className="flex flex-col gap-2">
        {children}
      </div>
    </section>
  );
}
