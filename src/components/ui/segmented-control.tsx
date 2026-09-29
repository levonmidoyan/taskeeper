// AlignUI SegmentedControl v0.0.0

'use client';

import * as React from 'react';
import { Slottable } from '@radix-ui/react-slot';
import * as SegmentedControlPrimitive from '@radix-ui/react-tabs';
import { useTabObserver } from '@/hooks/use-tab-observer';
import { cn } from '@/utils/cn';

const SegmentedControlRoot = SegmentedControlPrimitive.Root;
SegmentedControlRoot.displayName = 'SegmentedControlRoot';

const SegmentedControlList = React.forwardRef<
  React.ComponentRef<typeof SegmentedControlPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof SegmentedControlPrimitive.List> & {
    floatingBgClassName?: string;
  }
>(({ children, className, floatingBgClassName, ...rest }, forwardedRef) => {
  const [lineStyle, setLineStyle] = React.useState({ width: 0, left: 0 });

  const { mounted, listRef } = useTabObserver({
    onActiveTabChange: (_, activeTab) => {
      const { offsetWidth: width, offsetLeft: left } = activeTab;
      setLineStyle({ width, left });
    },
  });

  return (
    <SegmentedControlPrimitive.List
      ref={(node) => {
        listRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      className={cn(
        'relative isolate grid w-full auto-cols-fr grid-flow-col gap-1 rounded-10 bg-bg-weak-50 p-1',
        className,
      )}
      {...rest}
    >
      <Slottable>{children}</Slottable>

      {/* floating bg */}
      <div
        className={cn(
          'absolute inset-y-1 left-0 -z-10 rounded-md bg-bg-white-0 shadow-toggle-switch transition-transform duration-300',
          // Hidden until measured, and while no segment is active.
          (!mounted || lineStyle.width === 0) && 'hidden',
          floatingBgClassName,
        )}
        style={{
          transform: `translate3d(${lineStyle.left}px, 0, 0)`,
          width: `${lineStyle.width}px`,
          transitionTimingFunction: 'cubic-bezier(0.65, 0, 0.35, 1)',
        }}
        aria-hidden="true"
      />
    </SegmentedControlPrimitive.List>
  );
});
SegmentedControlList.displayName = 'SegmentedControlList';

const SegmentedControlTrigger = React.forwardRef<
  React.ComponentRef<typeof SegmentedControlPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SegmentedControlPrimitive.Trigger>
>(({ className, ...rest }, forwardedRef) => (
  <SegmentedControlPrimitive.Trigger
    ref={forwardedRef}
    className={cn(
      // base
      'peer',
      'relative z-10 h-7 whitespace-nowrap rounded-md px-1 text-label-sm text-text-soft-400 outline-none',
      'flex items-center justify-center gap-1.5',
      'transition duration-300 ease-out',
      // hover, focus
      'hover:text-text-sub-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-base',
      // active
      'data-[state=active]:text-text-strong-950',
      className,
    )}
    {...rest}
  />
));
SegmentedControlTrigger.displayName = 'SegmentedControlTrigger';

const SegmentedControlContent = SegmentedControlPrimitive.Content;
SegmentedControlContent.displayName = 'SegmentedControlContent';

export {
  SegmentedControlRoot as Root,
  SegmentedControlList as List,
  SegmentedControlTrigger as Trigger,
  SegmentedControlContent as Content,
};
