// AlignUI TabMenuVertical v0.0.0

'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { PolymorphicComponentProps } from '@/utils/polymorphic';
import { cn } from '@/utils/cn';

const TabMenuVerticalContent = TabsPrimitive.Content;
TabMenuVerticalContent.displayName = 'TabMenuVerticalContent';

const TabMenuVerticalRoot = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  Omit<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, 'orientation'>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.Root ref={forwardedRef} orientation="vertical" className={cn('w-full', className)} {...rest} />
));
TabMenuVerticalRoot.displayName = 'TabMenuVerticalRoot';

const TabMenuVerticalList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.List ref={forwardedRef} className={cn('w-full space-y-2', className)} {...rest} />
));
TabMenuVerticalList.displayName = 'TabMenuVerticalList';

const TabMenuVerticalTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...rest }, forwardedRef) => (
  <TabsPrimitive.Trigger
    ref={forwardedRef}
    className={cn(
      // base
      'group/tab-item w-full rounded-lg p-2 text-left text-label-sm text-text-sub-600 outline-none',
      'grid auto-cols-auto grid-flow-col grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5',
      'transition duration-200 ease-out',
      // hover
      'hover:bg-bg-weak-50',
      // focus
      'focus-visible:ring-2 focus-visible:ring-primary-alpha-16',
      // active
      'data-[state=active]:bg-bg-weak-50 data-[state=active]:text-text-strong-950',
      // disabled
      'disabled:pointer-events-none disabled:text-text-disabled-300',
      className,
    )}
    {...rest}
  />
));
TabMenuVerticalTrigger.displayName = 'TabMenuVerticalTrigger';

function TabMenuVerticalIcon<T extends React.ElementType = 'div'>({
  className,
  as,
  ...rest
}: PolymorphicComponentProps<T>) {
  const Component = as || 'div';

  return (
    <Component
      className={cn(
        // base
        'size-5 shrink-0 text-text-sub-600',
        'transition duration-200 ease-out',
        // active
        'group-data-[state=active]/tab-item:text-primary-base',
        className,
      )}
      {...rest}
    />
  );
}
TabMenuVerticalIcon.displayName = 'TabMenuVerticalIcon';

function TabMenuVerticalArrowIcon<T extends React.ElementType = 'div'>({
  className,
  as,
  ...rest
}: PolymorphicComponentProps<T, React.HTMLAttributes<HTMLDivElement>>) {
  const Component = as || 'div';

  return (
    <Component
      className={cn(
        // base
        'size-[18px] shrink-0 rounded-full bg-bg-white-0 p-px text-text-sub-600',
        'opacity-0 transition duration-200 ease-out',
        // active
        'group-data-[state=active]/tab-item:opacity-100',
        className,
      )}
      {...rest}
    />
  );
}
TabMenuVerticalArrowIcon.displayName = 'TabMenuVerticalArrowIcon';

export {
  TabMenuVerticalRoot as Root,
  TabMenuVerticalList as List,
  TabMenuVerticalTrigger as Trigger,
  TabMenuVerticalIcon as Icon,
  TabMenuVerticalArrowIcon as ArrowIcon,
  TabMenuVerticalContent as Content,
};
