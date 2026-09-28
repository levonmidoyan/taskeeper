import { IconLoader2 } from '@tabler/icons-react';
import { cn } from '@/utils/cn';

export function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <IconLoader2
      role="status"
      aria-label="Loading"
      className={cn('size-4 shrink-0 animate-spin', className)}
      {...(props as object)}
    />
  );
}
