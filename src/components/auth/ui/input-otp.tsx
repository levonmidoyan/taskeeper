'use client';

import { IconMinus } from '@tabler/icons-react';
import { OTPInput, OTPInputContext } from 'input-otp';
import * as React from 'react';
import { cn } from '@/utils/cn';

export const InputOTP = React.forwardRef<
  React.ComponentRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn('group/otp flex items-center gap-1.5 has-disabled:opacity-50', containerClassName)}
    className={cn('disabled:cursor-not-allowed', className)}
    {...props}
  />
));
InputOTP.displayName = 'InputOTP';

export function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-1', className)} {...props} />;
}

export function InputOTPSlot({ index, className, ...props }: React.ComponentProps<'div'> & { index: number }) {
  const context = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {};

  return (
    <div
      data-active={isActive}
      className={cn(
        'relative flex h-10 w-7 items-center sm:w-8 justify-center rounded-10 bg-bg-white-0 text-label-md text-text-strong-950',
        'shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200 transition duration-200 ease-out',
        'data-[active=true]:shadow-button-important-focus data-[active=true]:ring-stroke-strong-950',
        'group-has-[input[aria-invalid=true]]/otp:ring-error-base',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-pulse bg-text-strong-950" />
        </div>
      )}
    </div>
  );
}

export function InputOTPSeparator(props: React.ComponentProps<'div'>) {
  return (
    <div role="separator" className="text-text-soft-400" {...props}>
      <IconMinus className="size-4" aria-hidden="true" />
    </div>
  );
}
