import * as React from 'react';
import * as AlignInput from '@/components/ui/input';
import { cn } from '@/utils/cn';

/**
 * An Align input with addons inside the same frame. Addons render in JSX
 * order, which is how the registry already places inline-start and inline-end.
 */
export function InputGroup({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <AlignInput.Root
      className={cn(
        'has-[input[aria-invalid=true]]:before:ring-error-base',
        'has-[input[aria-invalid=true]:focus]:shadow-button-error-focus',
        className,
      )}
      {...props}
    >
      <AlignInput.Wrapper asChild>
        <div>{children}</div>
      </AlignInput.Wrapper>
    </AlignInput.Root>
  );
}

export const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>
>((props, ref) => <AlignInput.Input ref={ref} {...props} />);
InputGroupInput.displayName = 'InputGroupInput';

export function InputGroupAddon({
  className,
  align,
  ...props
}: React.ComponentProps<'div'> & { align?: 'inline-start' | 'inline-end' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center text-paragraph-sm text-text-soft-400 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupButton({
  className,
  size,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) {
  return (
    <button
      type={type}
      className={cn(
        '-mr-1 flex size-6 items-center justify-center rounded-md text-text-soft-400 outline-none',
        'transition duration-200 ease-out hover:text-text-sub-600',
        'focus-visible:shadow-button-important-focus [&_svg]:size-4',
        'disabled:pointer-events-none disabled:text-text-disabled-300',
        className,
      )}
      {...props}
    />
  );
}
