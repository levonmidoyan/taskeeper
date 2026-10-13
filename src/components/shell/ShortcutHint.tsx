'use client';

import * as Tooltip from '@/components/ui/tooltip';
import { formatBinding } from '@/lib/shortcuts/keys';
import { useIsMac } from '@/lib/shortcuts/provider';
import { shortcutById, type ShortcutId } from '@/lib/shortcuts/registry';
import { cn } from '@/utils/cn';

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd className={cn('min-w-5 rounded border border-stroke-soft-200 px-1.5 text-center text-label-xs text-text-sub-600', className)}>
      {children}
    </kbd>
  );
}

/** The key caps of a shortcut's first binding, read from the registry. */
export function ShortcutKeys({ id, kbdClassName }: { id: ShortcutId; kbdClassName?: string }) {
  const isMac = useIsMac();
  return (
    <span className="inline-flex items-center gap-1">
      {formatBinding(shortcutById(id).keys[0], isMac).flat().map((cap) => (
        <Kbd key={cap} className={kbdClassName}>{cap}</Kbd>
      ))}
    </span>
  );
}

/**
 * Jira-style hover hint naming the shortcut that does what the wrapped control
 * does. Hover only: a tooltip on focus would pop up each time a picker hands
 * focus back to its trigger, and the keyboard has the ? overlay.
 */
export function ShortcutTooltip({ id, children }: { id: ShortcutId; children: React.ReactElement }) {
  return (
    <Tooltip.Provider delayDuration={500} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild onFocus={(event) => event.preventDefault()}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Content size="xsmall" className="flex items-center gap-2">
          {shortcutById(id).label}
          <ShortcutKeys id={id} kbdClassName="border-white/25 text-text-white-0" />
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
