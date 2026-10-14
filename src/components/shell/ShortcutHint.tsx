'use client';

import { forwardRef } from 'react';
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
 * Hover hint naming what an icon-only control does, plus its shortcut when it has
 * one. Hover only: a tooltip on focus would pop up each time a menu or picker hands
 * focus back to its trigger, and screen readers already get the aria-label.
 *
 * Forwards props and ref, so it can sit between a Radix `asChild` trigger and its
 * button. Put it inside Dropdown/Popover/Modal triggers, never around them: the outer
 * trigger's props win, and a menu button must keep its own data-state.
 */
export const Hint = forwardRef<
  HTMLElement,
  {
    label?: React.ReactNode;
    shortcut?: ShortcutId;
    side?: 'top' | 'right' | 'bottom' | 'left';
    children: React.ReactElement;
  } & React.HTMLAttributes<HTMLElement>
>(function Hint({ label, shortcut, side, children, onFocus, ...rest }, ref) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        asChild
        ref={ref as React.Ref<HTMLButtonElement>}
        {...(rest as React.HTMLAttributes<HTMLButtonElement>)}
        onFocus={(event) => {
          onFocus?.(event);
          event.preventDefault();
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content size="xsmall" side={side} className="flex items-center gap-2">
        {label ?? (shortcut && shortcutById(shortcut).label)}
        {shortcut && <ShortcutKeys id={shortcut} kbdClassName="border-white/25 text-text-white-0" />}
      </Tooltip.Content>
    </Tooltip.Root>
  );
});

/** Jira-style hover hint naming the shortcut that does what the wrapped control does. */
export function ShortcutTooltip({ id, children }: { id: ShortcutId; children: React.ReactElement }) {
  return <Hint shortcut={id}>{children}</Hint>;
}
