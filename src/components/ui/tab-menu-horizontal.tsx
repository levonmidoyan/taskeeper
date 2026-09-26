// AlignUI TabMenuHorizontal v0.0.0

'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/utils/cn';

const TabMenuHorizontalRoot = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.Root ref={forwardedRef} className={cn('flex flex-col', className)} {...rest} />
));
TabMenuHorizontalRoot.displayName = 'TabMenuHorizontalRoot';

const TabMenuHorizontalList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.List
    ref={forwardedRef}
    className={cn('flex items-stretch gap-6 border-b border-stroke-soft-200', className)}
    {...rest}
  />
));
TabMenuHorizontalList.displayName = 'TabMenuHorizontalList';

const TabMenuHorizontalTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.Trigger
    ref={forwardedRef}
    className={cn(
      // base
      'group/tab-item relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent py-3.5 text-label-sm text-text-sub-600 outline-none',
      'transition duration-200 ease-out',
      // hover, focus
      'hover:text-text-strong-950 focus-visible:text-text-strong-950',
      // active
      'data-[state=active]:border-primary-base data-[state=active]:text-text-strong-950',
      // disabled
      'disabled:pointer-events-none disabled:text-text-disabled-300',
      className,
    )}
    {...rest}
  />
));
TabMenuHorizontalTrigger.displayName = 'TabMenuHorizontalTrigger';

const TabMenuHorizontalContent = TabsPrimitive.Content;
TabMenuHorizontalContent.displayName = 'TabMenuHorizontalContent';

export {
  TabMenuHorizontalRoot as Root,
  TabMenuHorizontalList as List,
  TabMenuHorizontalTrigger as Trigger,
  TabMenuHorizontalContent as Content,
};
