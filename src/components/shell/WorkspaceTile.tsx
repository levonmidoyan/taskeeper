import { tintTile } from '@/components/brand/tint';
import { cn } from '@/utils/cn';

/**
 * The workspace's icon: its uploaded logo when it has one, else its initial on
 * a gradient keyed by id. Decorative, since the name always sits beside it.
 */
export function WorkspaceTile({
  id,
  name,
  logo,
  className,
}: {
  id: string;
  name: string;
  logo: string | null;
  className?: string;
}) {
  const base = 'flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg shadow-regular-xs';

  if (logo) {
    // A data URL, so next/image has nothing to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" aria-hidden="true" className={cn(base, 'object-cover', className)} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(base, 'bg-linear-to-br font-display text-label-sm text-white', tintTile(id), className)}
    >
      {(name || 'W').charAt(0).toUpperCase()}
    </span>
  );
}
