import * as Badge from '@/components/ui/badge';

export function LabelChip({ name, className }: { name: string; className?: string }) {
  return (
    <Badge.Root variant="lighter" color="gray" size="medium" className={className}>
      {name}
    </Badge.Root>
  );
}
