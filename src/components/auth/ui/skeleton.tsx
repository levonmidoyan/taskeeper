import { cn } from '@/utils/cn';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-bg-soft-200', className)} {...props} />;
}
