// AlignUI Breadcrumb v0.0.0

'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/utils/cn';
import type { PolymorphicComponentProps } from '@/utils/polymorphic';

const BREADCRUMB_ROOT_NAME = 'BreadcrumbRoot';
const BREADCRUMB_ITEM_NAME = 'BreadcrumbItem';
const BREADCRUMB_ICON_NAME = 'BreadcrumbIcon';
const BREADCRUMB_ARROW_NAME = 'BreadcrumbArrow';

type BreadcrumbRootProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean;
};

function BreadcrumbRoot({ asChild, className, ...rest }: BreadcrumbRootProps) {
  const Component = asChild ? Slot : 'div';

  return <Component className={cn('flex flex-wrap items-center gap-1.5', className)} {...rest} />;
}
BreadcrumbRoot.displayName = BREADCRUMB_ROOT_NAME;

type BreadcrumbItemProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean;
  active?: boolean;
};

const BreadcrumbItem = React.forwardRef<HTMLDivElement, BreadcrumbItemProps>(
  ({ asChild, active, className, ...rest }, forwardedRef) => {
    const Component = asChild ? Slot : 'div';

    return (
      <Component
        ref={forwardedRef}
        className={cn(
          // base
          'flex items-center gap-1.5 text-label-sm text-text-sub-600',
          'transition duration-200 ease-out',
          // hover
          'hover:text-text-strong-950',
          // focus
          'focus:outline-none focus-visible:underline',
          // active
          'data-[active=true]:pointer-events-none data-[active=true]:text-text-strong-950',
          className,
        )}
        data-active={active ? 'true' : undefined}
        aria-current={active ? 'page' : undefined}
        {...rest}
      />
    );
  },
);
BreadcrumbItem.displayName = BREADCRUMB_ITEM_NAME;

function BreadcrumbItemIcon<T extends React.ElementType = 'div'>({
  className,
  as,
  ...rest
}: PolymorphicComponentProps<T>) {
  const Component = as || 'div';

  return <Component className={cn('size-5 shrink-0', className)} {...rest} />;
}
BreadcrumbItemIcon.displayName = BREADCRUMB_ICON_NAME;

function BreadcrumbItemArrowIcon<T extends React.ElementType = 'div'>({
  className,
  as,
  ...rest
}: PolymorphicComponentProps<T>) {
  const Component = as || 'div';

  return (
    <Component
      className={cn('size-5 shrink-0 select-none text-text-disabled-300', className)}
      aria-hidden="true"
      {...rest}
    />
  );
}
BreadcrumbItemArrowIcon.displayName = BREADCRUMB_ARROW_NAME;

export {
  BreadcrumbRoot as Root,
  BreadcrumbItem as Item,
  BreadcrumbItemIcon as Icon,
  BreadcrumbItemArrowIcon as ArrowIcon,
};
