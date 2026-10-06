'use client';

import { IconCalendar, IconChartPie, IconChevronDown, IconLayoutKanban, IconList, IconLock } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import * as Dropdown from '@/components/ui/dropdown';
import { MAX_VIEW_TABS, viewHref, type ViewLayout } from '@/lib/views';
import type { SavedView } from '@/server/views/queries';
import { cn } from '@/utils/cn';

const LAYOUT_ICON: Record<ViewLayout, typeof IconList> = { board: IconLayoutKanban, list: IconList, calendar: IconCalendar };

const tab = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-label-sm transition-colors duration-150';
const tabActive = 'bg-bg-white-0 text-text-strong-950 shadow-regular-xs';
const tabIdle = 'text-text-sub-600 hover:text-text-strong-950';

export function ViewTabs({
  basePath,
  workspaceSlug,
  views = [],
}: {
  basePath: string;
  workspaceSlug?: string;
  views?: SavedView[];
}) {
  const pathname = usePathname();
  const openView = useSearchParams().get('view');
  const onSummary = pathname.endsWith('/summary');
  const onList = pathname.endsWith('/list');
  const onCalendar = pathname.endsWith('/calendar');
  const builtIn = !openView;

  const fixed = [
    { href: `${basePath}/summary`, label: 'Summary', icon: IconChartPie, active: onSummary },
    { href: basePath, label: 'Board', icon: IconLayoutKanban, active: builtIn && !onSummary && !onList && !onCalendar },
    { href: `${basePath}/list`, label: 'List', icon: IconList, active: builtIn && onList },
    { href: `${basePath}/calendar`, label: 'Calendar', icon: IconCalendar, active: builtIn && onCalendar },
  ];
  const visible = views.slice(0, MAX_VIEW_TABS);
  const overflow = views.slice(MAX_VIEW_TABS);

  return (
    <div role="tablist" aria-label="Project views" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-10 bg-bg-weak-50 p-1">
      {fixed.map(({ href, label, icon: Icon, active }) => (
        <Link key={label} href={href} role="tab" aria-selected={active} className={cn(tab, active ? tabActive : tabIdle)}>
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
      {workspaceSlug && visible.map((view) => {
        const Icon = LAYOUT_ICON[view.layout];
        const active = openView === view.id;
        return (
          <Link
            key={view.id}
            href={viewHref(workspaceSlug, view)}
            role="tab"
            aria-selected={active}
            className={cn(tab, 'max-w-44', active ? tabActive : tabIdle)}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{view.name}</span>
            {!view.shared && <IconLock className="size-3.5 shrink-0 text-text-soft-400" aria-label="Private" />}
          </Link>
        );
      })}
      {workspaceSlug && overflow.length > 0 && (
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button type="button" className={cn(tab, overflow.some((v) => v.id === openView) ? tabActive : tabIdle)}>
              More views
              <IconChevronDown className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end">
            {overflow.map((view) => (
              <Dropdown.Item key={view.id} asChild>
                <Link href={viewHref(workspaceSlug, view)}>
                  <Dropdown.ItemIcon as={LAYOUT_ICON[view.layout]} />
                  {view.name}
                  {!view.shared && <IconLock className="ml-auto size-3.5 text-text-soft-400" aria-label="Private" />}
                </Link>
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Root>
      )}
    </div>
  );
}
