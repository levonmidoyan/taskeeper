import { cn } from '@/utils/cn';

export function Alert({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col gap-1 rounded-xl bg-bg-weak-50 p-3 ring-1 ring-inset ring-stroke-soft-200', className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-label-sm text-text-strong-950', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-paragraph-sm text-text-sub-600', className)} {...props} />;
}
