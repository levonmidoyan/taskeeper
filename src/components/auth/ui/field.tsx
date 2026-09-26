import * as Label from '@/components/ui/label';
import { cn } from '@/utils/cn';

export function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & { orientation?: 'vertical' | 'horizontal' }) {
  return (
    <div
      role="group"
      data-orientation={orientation}
      className={cn(
        orientation === 'horizontal' ? 'flex flex-row items-center gap-2' : 'flex flex-col gap-1',
        className,
      )}
      {...props}
    />
  );
}

export function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-1 flex-col gap-1', className)} {...props} />;
}

export function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label.Root>) {
  return <Label.Root className={className} {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'text-paragraph-sm text-text-sub-600',
        '[&_a]:text-label-sm [&_a]:text-primary-base [&_a]:underline-offset-4 [&_a:hover]:underline [&_a]:no-underline',
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'p'> & { errors?: Array<{ message?: string } | undefined> }) {
  const messages = [...new Set((errors ?? []).map((error) => error?.message).filter(Boolean))];
  const content = children ?? (messages.length > 0 ? messages.join(' ') : null);
  if (!content) return null;

  return (
    <p role="alert" className={cn('text-paragraph-xs text-error-base', className)} {...props}>
      {content}
    </p>
  );
}

export function FieldSeparator({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 text-subheading-2xs uppercase text-text-soft-400',
        'before:h-px before:flex-1 before:bg-stroke-soft-200 after:h-px after:flex-1 after:bg-stroke-soft-200',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return <fieldset className={cn('flex min-w-0 flex-col gap-3', className)} {...props} />;
}

export function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      className={cn(
        'mb-1 text-text-strong-950',
        variant === 'label' ? 'text-label-sm' : 'text-label-md',
        className,
      )}
      {...props}
    />
  );
}
