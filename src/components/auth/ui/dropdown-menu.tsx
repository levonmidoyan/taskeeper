'use client';

import * as React from 'react';
import * as AlignDropdown from '@/components/ui/dropdown';
import { cn } from '@/utils/cn';

export const DropdownMenu = AlignDropdown.Root;
export const DropdownMenuTrigger = AlignDropdown.Trigger;
export const DropdownMenuGroup = AlignDropdown.Group;
export const DropdownMenuSub = AlignDropdown.MenuSub;
export const DropdownMenuSubTrigger = AlignDropdown.MenuSubTrigger;
export const DropdownMenuSubContent = AlignDropdown.MenuSubContent;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof AlignDropdown.Content>,
  React.ComponentPropsWithoutRef<typeof AlignDropdown.Content>
>(({ className, ...props }, ref) => (
  // Align's menu is a fixed 300px; the registry sizes its menus itself.
  <AlignDropdown.Content ref={ref} className={cn('w-auto min-w-48', className)} {...props} />
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof AlignDropdown.Item>,
  React.ComponentPropsWithoutRef<typeof AlignDropdown.Item> & {
    variant?: 'default' | 'destructive';
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <AlignDropdown.Item
    ref={ref}
    className={cn(
      // Registry icons are unsized; size them like Align's DropdownItemIcon.
      '[&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-text-sub-600',
      'data-[disabled]:pointer-events-none data-[disabled]:[&_svg]:text-text-disabled-300',
      variant === 'destructive' && 'text-error-base [&_svg]:text-error-base',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

/** Align's label is a small-caps heading; the registry uses it to hold content. */
export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof AlignDropdown.Label>,
  React.ComponentPropsWithoutRef<typeof AlignDropdown.Label>
>(({ className, ...props }, ref) => (
  <AlignDropdown.Label
    ref={ref}
    className={cn('p-2 normal-case text-paragraph-sm text-text-strong-950', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <AlignDropdown.Separator className={cn('-mx-2 my-1 h-px bg-stroke-soft-200', className)} />;
}
