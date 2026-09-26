import * as React from 'react';
import { buttonVariants as alignButtonVariants } from '@/components/ui/button';
import { cn } from '@/utils/cn';

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
type Size = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs';

const ALIGN_VARIANT = {
  default: { variant: 'primary', mode: 'filled' },
  outline: { variant: 'neutral', mode: 'stroke' },
  secondary: { variant: 'neutral', mode: 'lighter' },
  ghost: { variant: 'neutral', mode: 'ghost' },
  destructive: { variant: 'error', mode: 'filled' },
  link: { variant: 'primary', mode: 'ghost' },
} as const;

const ALIGN_SIZE = {
  default: 'medium',
  lg: 'medium',
  sm: 'small',
  icon: 'medium',
  'icon-sm': 'small',
  'icon-xs': 'xxsmall',
} as const;

const ICON_ONLY: Partial<Record<Size, string>> = {
  icon: 'w-10 px-0',
  'icon-sm': 'w-9 px-0',
  'icon-xs': 'w-7 px-0',
};

export type ButtonVariantProps = { variant?: Variant | null; size?: Size | null };

/** Class string for a shadcn variant/size pair, rendered as the matching Align button. */
export function buttonVariants({ variant, size }: ButtonVariantProps = {}) {
  const v = ALIGN_VARIANT[variant ?? 'default'];
  const s = size ?? 'default';
  return cn(
    alignButtonVariants({ ...v, size: ALIGN_SIZE[s] }).root(),
    ICON_ONLY[s],
    variant === 'link' && 'h-auto px-0 underline-offset-4 hover:bg-transparent hover:underline',
    // Registry icons are unsized; shadcn sizes them from the button.
    '[&_svg]:size-4 [&_svg]:shrink-0',
  );
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantProps
>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
