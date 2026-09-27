import type { Icon as TablerIcon } from '@tabler/icons-react';
import { cn } from '@/utils/cn';

/*
 * Body for 404 / error screens, rendered inside AuthShell so they share the auth pages'
 * split layout. The status code sits behind the icon as an oversized gradient numeral.
 */
export function StatusScreen({
  code,
  icon: Icon,
  title,
  description,
  children,
  footnote,
}: {
  code: string;
  icon: TablerIcon;
  title: string;
  description: React.ReactNode;
  /** Actions, stacked full-width. */
  children?: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="relative w-fit">
        <span
          aria-hidden="true"
          className={cn(
            'block select-none font-display text-[7rem] leading-none font-extrabold tracking-tighter',
            'bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-400 bg-clip-text text-transparent',
            'opacity-90 dark:from-indigo-300 dark:via-violet-300 dark:to-fuchsia-300',
          )}
        >
          {code}
        </span>
        <span className="absolute -right-4 -bottom-2 flex size-12 rotate-6 items-center justify-center rounded-2xl bg-bg-white-0 shadow-regular-md ring-1 ring-inset ring-stroke-soft-200">
          <Icon className="size-6 text-primary-base" stroke={1.75} />
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="font-display text-title-h4 tracking-tight text-text-strong-950">{title}</h1>
        <p className="text-paragraph-sm text-text-sub-600">{description}</p>
      </div>

      {children && <div className="flex flex-col gap-3">{children}</div>}

      {footnote && <p className="text-paragraph-xs text-text-soft-400">{footnote}</p>}
    </div>
  );
}
