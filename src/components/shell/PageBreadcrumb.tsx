'use client';

// Client: the Align primitives below take icon components via `as`, which can't cross the RSC boundary.

import { IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import { Fragment } from 'react';
import * as Breadcrumb from '@/components/ui/breadcrumb';
import type { Crumb } from '@/components/shell/crumbs';
import { cn } from '@/utils/cn';

/** Trail above a page title. The last crumb is the current page. */
export function PageBreadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <Breadcrumb.Root asChild className={cn('min-w-0 flex-nowrap', className)}>
      <nav aria-label="Breadcrumb">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          const body = (
            <>
              {crumb.icon && <Breadcrumb.Icon as={crumb.icon} aria-hidden="true" />}
              <span className={cn('truncate', crumb.iconOnly && 'sr-only')}>{crumb.label}</span>
            </>
          );

          return (
            <Fragment key={`${i}-${crumb.label}`}>
              {i > 0 && <Breadcrumb.ArrowIcon as={IconChevronRight} />}
              {crumb.href && !last ? (
                // Ancestors keep a few letters when space runs out; the current page gives way first.
                <Breadcrumb.Item asChild className={cn('max-w-48', crumb.iconOnly ? 'shrink-0' : 'min-w-16')}>
                  <Link href={crumb.href}>{body}</Link>
                </Breadcrumb.Item>
              ) : (
                <Breadcrumb.Item active={last} className="min-w-0">
                  {body}
                </Breadcrumb.Item>
              )}
            </Fragment>
          );
        })}
      </nav>
    </Breadcrumb.Root>
  );
}
