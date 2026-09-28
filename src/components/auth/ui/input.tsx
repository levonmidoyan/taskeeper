import * as React from 'react';
import * as AlignInput from '@/components/ui/input';

/** A single Align input. `aria-invalid` drives the error ring, as in shadcn. */
export const Input = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>>(
  ({ className, ...props }, ref) => {
    const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';

    return (
      <AlignInput.Root hasError={invalid} className={className}>
        <AlignInput.Wrapper asChild>
          <div>
            <AlignInput.Input ref={ref} {...props} />
          </div>
        </AlignInput.Wrapper>
      </AlignInput.Root>
    );
  },
);
Input.displayName = 'Input';
