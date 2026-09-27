import { useId } from 'react';
import { cn } from '@/utils/cn';

/** Taskeeper mark: a check inside a rounded indigo→violet tile. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="oklch(58.5% 0.233 277.1)" />
          <stop offset="1" stopColor="oklch(55% 0.24 305)" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="16" y1="0" x2="16" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="white" stopOpacity="0.35" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-bg)`} />
      <rect width="32" height="18" rx="9" fill={`url(#${id}-shine)`} />
      <path
        d="M9.5 16.5l4.2 4.2L22.5 11"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="font-display text-[1.0625rem] font-bold tracking-tight">Taskeeper</span>
    </span>
  );
}
