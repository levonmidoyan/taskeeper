'use client';

import { IconCalendar, IconChartPie, IconChevronDown, IconLayoutKanban, IconList, IconLock } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { type MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import * as Dropdown from '@/components/ui/dropdown';
import { viewSwitchType } from '@/lib/motion';
import { MAX_VIEW_TABS, viewHref, type ViewLayout } from '@/lib/views';
import type { SavedView } from '@/server/views/queries';
import { cn } from '@/utils/cn';

const LAYOUT_ICON: Record<ViewLayout, typeof IconList> = { board: IconLayoutKanban, list: IconList, calendar: IconCalendar };

const tab = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-3 text-label-sm transition-colors duration-300';
const tabActive = 'text-text-strong-950';
const tabIdle = 'text-text-sub-600 hover:text-text-strong-950';

/** The segmented control's glide (task activity tabs), so both pills move alike. */
const PILL_GLIDE = '300ms cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Where the pill last was. Each project view renders its own header, so the
 * tabs remount on every switch; the new pill glides on from here.
 */
let lastPill: { basePath: string; left: number; width: number } | null = null;

/**
 * The white pill behind the active tab (`[data-active]`), gliding between tabs
 * like the segmented control's. Written straight to the DOM: a remount must
 * place it at the old spot and start the glide before the first paint.
 */
function useSlidingPill(basePath: string, activeIndex: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) return;
    const place = (glide: boolean) => {
      const active = list.querySelector<HTMLElement>('[data-active]');
      pill.style.visibility = active ? 'visible' : 'hidden';
      if (!active) return;
      pill.style.transition = glide ? `transform ${PILL_GLIDE}, width ${PILL_GLIDE}` : 'none';
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
    };
    if (!placed.current) {
      placed.current = true;
      const from = lastPill?.basePath === basePath ? lastPill : null;
      if (from && list.querySelector('[data-active]')) {
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${from.left}px)`;
        pill.style.width = `${from.width}px`;
        pill.getBoundingClientRect(); // commit the start, so the glide runs from it
        place(true);
      } else {
        place(false);
      }
    } else {
      place(true);
    }
    const resize = new ResizeObserver(() => place(false));
    resize.observe(list);
    return () => resize.disconnect();
  }, [basePath, activeIndex]);

  // Remember where the pill is drawn now, mid-glide included, for the next mount.
  useLayoutEffect(() => () => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill || pill.style.visibility === 'hidden') return;
    const at = pill.getBoundingClientRect();
    if (at.width === 0) return;
    lastPill = { basePath, left: at.left - list.getBoundingClientRect().left + list.scrollLeft, width: at.width };
  }, [basePath]);

  return { listRef, pillRef };
}

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
  // Tab order is Summary, Board, List, Calendar, then saved views (overflow last);
  // a view switch slides toward the side of the tab picked.
  const openIndex = openView ? fixed.length + views.findIndex((v) => v.id === openView) : fixed.findIndex((t) => t.active);
  const slideTo = (index: number) => [viewSwitchType(openIndex, index)];
  const visible = views.slice(0, MAX_VIEW_TABS);
  const overflow = views.slice(MAX_VIEW_TABS);
  const firstOverflow = fixed.length + MAX_VIEW_TABS;

  // The pill moves on click, not when the new view arrives; a new route or view
  // drops the pick, as `from` no longer matches.
  const [picked, setPicked] = useState<{ from: number; to: number } | null>(null);
  const activeIndex = picked?.from === openIndex ? picked.to : openIndex;
  const pick = (index: number) => (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setPicked({ from: openIndex, to: index });
  };
  const { listRef, pillRef } = useSlidingPill(basePath, activeIndex);
  const lit = (index: number) => (index === activeIndex ? { 'data-active': true } : {});

  return (
    <div ref={listRef} role="tablist" aria-label="Project views" className="relative isolate flex max-w-full items-center gap-1 overflow-x-auto rounded-10 bg-bg-weak-50 p-1">
      <div
        ref={pillRef}
        aria-hidden="true"
        className="invisible absolute inset-y-1 left-0 -z-10 rounded-lg bg-bg-white-0 shadow-regular-xs"
      />
      {fixed.map(({ href, label, icon: Icon, active }, i) => (
        <Link
          key={label}
          href={href}
          transitionTypes={slideTo(i)}
          onClick={pick(i)}
          role="tab"
          aria-selected={active}
          {...lit(i)}
          className={cn(tab, i === activeIndex ? tabActive : tabIdle)}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
      {workspaceSlug && visible.map((view, i) => {
        const Icon = LAYOUT_ICON[view.layout];
        const index = fixed.length + i;
        return (
          <Link
            transitionTypes={slideTo(index)}
            onClick={pick(index)}
            key={view.id}
            href={viewHref(workspaceSlug, view)}
            role="tab"
            aria-selected={openView === view.id}
            {...lit(index)}
            className={cn(tab, 'max-w-44', index === activeIndex ? tabActive : tabIdle)}
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
            <button
              type="button"
              {...(activeIndex >= firstOverflow ? { 'data-active': true } : {})}
              className={cn(tab, activeIndex >= firstOverflow ? tabActive : tabIdle)}
            >
              More views
              <IconChevronDown className="size-4" aria-hidden="true" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Content align="end">
            {overflow.map((view, i) => (
              <Dropdown.Item key={view.id} asChild>
                <Link
                  href={viewHref(workspaceSlug, view)}
                  transitionTypes={slideTo(firstOverflow + i)}
                  onClick={pick(firstOverflow + i)}
                >
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
