'use client';

import { IconLayoutKanban, IconList } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/utils/cn';

export function ViewTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const onBoard = pathname.endsWith('/board');

  const views = [
    { href: basePath, label: 'List', icon: IconList, active: !onBoard },
    { href: `${basePath}/board`, label: 'Board', icon: IconLayoutKanban, active: onBoard },
  ];

  return (
    <div
      role="tablist"
      aria-label="Project views"
      className="flex items-center gap-1 rounded-10 bg-bg-weak-50 p-1"
    >
      {views.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          role="tab"
          aria-selected={active}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm transition-colors duration-150',
            active
              ? 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs'
              : 'text-text-sub-600 hover:text-text-strong-950',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </div>
  );
}
