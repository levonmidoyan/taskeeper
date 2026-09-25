import * as Hint from '@/components/ui/hint';
import * as Input from '@/components/ui/input';
import * as Label from '@/components/ui/label';
import { cn } from '@/utils/cn';

type TextFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'>;

/**
 * Label, Align input and optional hint. The input's accessible name is exactly `label`
 * (e2e locates fields with getByLabel), and the hint is wired up as its description.
 */
export function TextField({ id, label, hint, error, className, ...input }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label.Root htmlFor={id}>{label}</Label.Root>
      <Input.Root hasError={error}>
        <Input.Wrapper>
          <Input.Input id={id} aria-describedby={hintId} aria-invalid={error || undefined} {...input} />
        </Input.Wrapper>
      </Input.Root>
      {hint && <Hint.Root id={hintId}>{hint}</Hint.Root>}
    </div>
  );
}

export function FormError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-paragraph-sm text-error-base">
      {children}
    </p>
  );
}
