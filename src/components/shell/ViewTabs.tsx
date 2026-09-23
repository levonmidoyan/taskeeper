'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KanbanSquare, List } from 'lucide-react';

export function ViewTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const onBoard = pathname.endsWith('/board');

  const views = [
    { href: basePath, label: 'List', icon: List, active: !onBoard },
    { href: `${basePath}/board`, label: 'Board', icon: KanbanSquare, active: onBoard },
  ];

  return (
    <div
      role="tablist"
      aria-label="Project views"
      className="flex items-center gap-1 rounded-[var(--radius-button)] bg-muted p-1"
    >
      {views.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={label}
          href={href}
          role="tab"
          aria-selected={active}
          className={`inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] px-3 text-sm transition-colors duration-150 ${
            active
              ? 'bg-card font-semibold text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </div>
  );
}
