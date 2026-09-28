import * as Divider from '@/components/ui/divider';
import { cn } from '@/utils/cn';

/** A list row: media, text, actions. Rows sit flush inside a card, split by separators. */
export function Item({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 px-4 py-3', className)} {...props} />;
}

export function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="list" className={cn('flex flex-col', className)} {...props} />;
}

export function ItemSeparator({ className }: { className?: string }) {
  return <Divider.Root className={className} />;
}

export function ItemMedia({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'icon' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center',
        variant === 'icon' &&
          'size-10 rounded-10 bg-bg-weak-50 text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200 [&_svg]:size-5',
        className,
      )}
      {...props}
    />
  );
}

export function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-1 flex-col items-start gap-1', className)} {...props} />;
}

export function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('truncate text-label-sm text-text-strong-950', className)} {...props} />;
}

export function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('truncate text-paragraph-xs text-text-sub-600', className)} {...props} />;
}

export function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex shrink-0 items-center gap-2', className)} {...props} />;
}
