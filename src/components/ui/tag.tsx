// AlignUI Tag v0.0.0

'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { IconX } from '@tabler/icons-react';
import { tv, type VariantProps } from '@/utils/tv';
import type { PolymorphicComponentProps } from '@/utils/polymorphic';

export const tagVariants = tv({
  slots: {
    root: [
      'group/tag inline-flex h-6 items-center gap-0.5 whitespace-nowrap rounded-md px-2 text-label-xs text-text-sub-600',
      'transition duration-200 ease-out',
      'ring-1 ring-inset',
      // A dismiss button sits flush with the edge, so the text keeps its inset.
      'has-[>.dismiss-button]:pr-1',
    ],
    icon: '-ml-0.5 mr-1 size-4 shrink-0 text-text-soft-400',
    dismissButton: [
      'dismiss-button flex size-4 shrink-0 items-center justify-center rounded-sm text-text-soft-400',
      'transition duration-200 ease-out hover:text-text-sub-600',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-base',
    ],
    dismissIcon: 'size-3.5',
  },
  variants: {
    variant: {
      // Light fill with a hairline edge; lifts to white on hover.
      gray: {
        root: 'bg-bg-weak-50 ring-stroke-soft-200 shadow-[inset_0_0.75px_0.75px_rgb(255_255_255/0.64)] hover:bg-bg-white-0 dark:shadow-none',
      },
      stroke: {
        root: 'bg-bg-white-0 ring-stroke-soft-200 hover:bg-bg-weak-50 hover:ring-transparent',
      },
    },
    disabled: {
      true: {
        root: 'pointer-events-none bg-bg-weak-50 text-text-disabled-300 ring-transparent',
      },
    },
  },
  defaultVariants: {
    variant: 'gray',
  },
});

type TagRootProps = VariantProps<typeof tagVariants> &
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean;
  };

const TagRoot = React.forwardRef<HTMLDivElement, TagRootProps>(
  ({ asChild, variant, disabled, className, ...rest }, forwardedRef) => {
    const Component = asChild ? Slot : 'div';
    const { root } = tagVariants({ variant, disabled });

    return (
      <Component
        ref={forwardedRef}
        aria-disabled={disabled || undefined}
        className={root({ class: className })}
        {...rest}
      />
    );
  },
);
TagRoot.displayName = 'TagRoot';

function TagIcon<T extends React.ElementType>({
  as,
  className,
  ...rest
}: PolymorphicComponentProps<T>) {
  const Component = as || 'div';
  const { icon } = tagVariants();

  return <Component className={icon({ class: className })} {...rest} />;
}
TagIcon.displayName = 'TagIcon';

const TagDismissButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ children, className, ...rest }, forwardedRef) => {
  const { dismissButton, dismissIcon } = tagVariants();

  return (
    <button
      ref={forwardedRef}
      type="button"
      className={dismissButton({ class: className })}
      {...rest}
    >
      {children ?? <IconX className={dismissIcon()} aria-hidden="true" />}
    </button>
  );
});
TagDismissButton.displayName = 'TagDismissButton';

export { TagRoot as Root, TagIcon as Icon, TagDismissButton as DismissButton };
