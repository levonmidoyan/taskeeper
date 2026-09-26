import * as React from 'react';
import { cn } from '@/utils/cn';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-10 bg-bg-white-0 px-3 py-2.5 text-paragraph-sm text-text-strong-950 shadow-regular-xs outline-none',
        'ring-1 ring-inset ring-stroke-soft-200 transition duration-200 ease-out placeholder:text-text-soft-400',
        'focus:shadow-button-important-focus focus:ring-stroke-strong-950',
        'aria-invalid:ring-error-base disabled:bg-bg-weak-50 disabled:text-text-disabled-300',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
