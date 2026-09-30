'use client';

import { IconCheck } from '@tabler/icons-react';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { PROJECT_COLORS, projectColor, type ProjectColor } from '@/components/brand/tint';
import * as Popover from '@/components/ui/popover';
import { settle } from '@/lib/settle';
import { setProjectColorAction } from '@/server/projects/actions';
import { cn } from '@/utils/cn';

/** Row of color swatches, one of them checked. Arrow keys move between them, like a radio group. */
export function ColorSwatches({
  value,
  onChange,
  className,
}: {
  value: ProjectColor;
  onChange: (color: ProjectColor) => void;
  className?: string;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const i = PROJECT_COLORS.findIndex((c) => c.key === value);
    const next = PROJECT_COLORS[(i + step + PROJECT_COLORS.length) % PROJECT_COLORS.length];
    onChange(next.key);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-color="${next.key}"]`)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Project color" onKeyDown={onKeyDown} className={cn('flex flex-wrap gap-2', className)}>
      {PROJECT_COLORS.map((c) => {
        const checked = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={c.label}
            title={c.label}
            data-color={c.key}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(c.key)}
            className={cn(
              'flex size-7 items-center justify-center rounded-lg text-static-white transition-transform duration-150 hover:scale-110',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base focus-visible:ring-offset-2 focus-visible:ring-offset-bg-white-0',
              c.dot,
              checked && 'ring-2 ring-stroke-strong-950/20 ring-offset-2 ring-offset-bg-white-0',
            )}
          >
            {checked && <IconCheck className="size-4" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The project's marker dot, doubling as the button that recolors it. Changes
 * show at once; the rest of the app catches up when the action revalidates.
 */
export function ProjectColorButton({
  workspaceSlug,
  project,
  active,
  className,
}: {
  workspaceSlug: string;
  project: { id: string; name: string; color: string };
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useOptimistic(projectColor(project));
  const [, startTransition] = useTransition();
  const dot = PROJECT_COLORS.find((c) => c.key === shown)!.dot;

  function pick(color: ProjectColor) {
    if (color === shown) return;
    startTransition(async () => {
      setShown(color);
      const result = await settle(setProjectColorAction(workspaceSlug, { projectId: project.id, color }));
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Change color of ${project.name}`}
        className={cn(
          'group/dot flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
          'hover:bg-bg-weak-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-[3px] transition-transform duration-150 group-hover/dot:scale-150',
            dot,
            active || open ? 'scale-125' : 'opacity-80',
          )}
        />
      </Popover.Trigger>
      <Popover.Content side="right" align="start" showArrow={false} sideOffset={8} className="p-3">
        <p className="mb-2 text-label-xs text-text-sub-600">Color</p>
        <ColorSwatches value={shown} onChange={pick} className="grid w-max grid-cols-4" />
      </Popover.Content>
    </Popover.Root>
  );
}
