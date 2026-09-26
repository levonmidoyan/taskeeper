import * as React from 'react';
import { cn } from '@/utils/cn';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

/** Native checkbox in Align's primary colour; keeps shadcn's `onCheckedChange`. */
export function Checkbox({ className, checked, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      className={cn('size-4 shrink-0 cursor-pointer rounded accent-primary-base disabled:cursor-default', className)}
      {...props}
    />
  );
}
