import * as Tag from '@/components/ui/tag';

export function LabelChip({
  name,
  className,
  onRemove,
}: {
  name: string;
  className?: string;
  /** Shows a dismiss button that calls this. */
  onRemove?: () => void;
}) {
  return (
    <Tag.Root className={className}>
      {name}
      {onRemove && <Tag.DismissButton aria-label={`Remove label ${name}`} onClick={onRemove} />}
    </Tag.Root>
  );
}
