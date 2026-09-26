import * as AlignBadge from '@/components/ui/badge';

const ALIGN_BADGE = {
  default: { variant: 'lighter', color: 'gray' },
  secondary: { variant: 'lighter', color: 'gray' },
  success: { variant: 'lighter', color: 'green' },
  destructive: { variant: 'lighter', color: 'red' },
  outline: { variant: 'stroke', color: 'gray' },
} as const;

export function Badge({
  className,
  variant,
  ...props
}: Omit<React.ComponentProps<'div'>, 'color'> & { variant?: string }) {
  const align = ALIGN_BADGE[variant as keyof typeof ALIGN_BADGE] ?? ALIGN_BADGE.default;
  return <AlignBadge.Root {...align} size="medium" className={className} {...props} />;
}
