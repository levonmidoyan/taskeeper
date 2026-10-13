import { IconCircle, IconCircleCheckFilled } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/**
 * The done toggle's icon. Both icons stay mounted and cross over with CSS
 * transitions, so only a change animates: rows that load already done do not.
 */
export function DoneIcon({ done, className }: { done: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex', className)} aria-hidden="true">
      <IconCircle
        className={cn('size-full transition-[opacity,scale] duration-180 ease-out-soft', done ? 'scale-50 opacity-0' : 'opacity-100')}
      />
      <IconCircleCheckFilled
        className={cn(
          'absolute inset-0 size-full text-success-base transition-[opacity,scale] duration-180 ease-spring',
          done ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      />
    </span>
  );
}

/** A strike-through that sweeps left to right (a 1px background line, inline so it follows the text). */
export function StrikeText({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span
      data-strike
      className={cn(
        'bg-[linear-gradient(currentColor,currentColor)] bg-[position:0_55%] bg-no-repeat [box-decoration-break:clone]',
        'transition-[background-size] duration-220 ease-out-soft',
        done ? 'bg-[length:100%_1px]' : 'bg-[length:0%_1px]',
      )}
    >
      {children}
    </span>
  );
}
