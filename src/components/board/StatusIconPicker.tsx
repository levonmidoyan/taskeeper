'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { derivedIcon, STATUS_ICONS, StatusIcon } from '@/components/task/StatusIcon';
import * as Popover from '@/components/ui/popover';
import { settle } from '@/lib/settle';
import { STATUS_ICON_KEYS, type StatusIconKey } from '@/lib/status-icons';
import type { StatusRow } from '@/server/projects/queries';
import { updateStatusAction } from '@/server/statuses/actions';
import { cn } from '@/utils/cn';

const OPTIONS: (StatusIconKey | null)[] = [null, ...STATUS_ICON_KEYS];

/**
 * A column's icon, doubling as the button that changes it. "Auto" clears the
 * choice so the glyph follows the column's done flag again. The pick shows at
 * once; the board catches up when the action revalidates.
 */
export function StatusIconPicker({
  workspaceSlug,
  status,
  disabled,
}: {
  workspaceSlug: string;
  status: StatusRow;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useOptimistic(status.icon);
  const [, startTransition] = useTransition();

  function pick(icon: StatusIconKey | null) {
    setOpen(false);
    if (icon === shown) return;
    startTransition(async () => {
      setShown(icon);
      const result = await settle(updateStatusAction(workspaceSlug, { statusId: status.id, icon }));
      if (!result.ok) toast.error(result.error ?? 'Something went wrong. Please try again.');
      router.refresh();
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[event.key];
    if (!step) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Change icon of ${status.name}`}
        disabled={disabled}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
          'hover:bg-bg-soft-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <StatusIcon status={{ ...status, icon: shown }} />
      </Popover.Trigger>
      <Popover.Content align="start" showArrow={false} sideOffset={6} className="p-3">
        <p className="mb-2 text-label-xs text-text-sub-600">Icon</p>
        <div role="radiogroup" aria-label={`${status.name} icon`} onKeyDown={onKeyDown} className="grid w-max grid-cols-6 gap-1">
          {OPTIONS.map((key) => {
            const checked = key === shown;
            const { glyph: Glyph } = STATUS_ICONS[key ?? derivedIcon(status)];
            const label = key ? STATUS_ICONS[key].label : 'Auto';
            return (
              <button
                key={key ?? 'auto'}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={label}
                title={label}
                onClick={() => pick(key)}
                className={cn(
                  'relative flex size-8 items-center justify-center rounded-lg text-text-sub-600 transition-colors duration-150',
                  'hover:bg-bg-weak-50 hover:text-text-strong-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
                  checked && 'bg-primary-alpha-10 text-primary-base hover:bg-primary-alpha-10 hover:text-primary-base',
                )}
              >
                <Glyph className="size-[18px]" aria-hidden="true" />
                {!key && <span aria-hidden="true" className="absolute right-0.5 bottom-0 text-[9px] font-semibold leading-none">A</span>}
              </button>
            );
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
