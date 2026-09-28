// AlignUI Datepicker v0.0.0 (ported to react-day-picker v9)

'use client';

import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { compactButtonVariants } from '@/components/ui/compact-button';
import { cn } from '@/utils/cn';

function Calendar({
  classNames,
  showOutsideDays = true,
  ...rest
}: React.ComponentProps<typeof DayPicker>) {
  const navButton = compactButtonVariants({ variant: 'white', size: 'large' }).root({
    class: 'size-6 rounded-md',
  });

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      classNames={{
        root: 'relative',
        months: 'flex divide-x divide-stroke-soft-200',
        month: 'flex flex-col gap-2',
        month_caption:
          'flex h-9 items-center justify-center rounded-lg bg-bg-weak-50',
        caption_label: 'select-none text-label-sm text-text-sub-600',
        nav: 'absolute inset-x-1.5 top-1.5 z-10 flex items-center justify-between',
        button_previous: navButton,
        button_next: navButton,
        month_grid: 'w-full border-collapse',
        weekdays: 'flex gap-1',
        weekday:
          'flex size-9 select-none items-center justify-center text-center text-label-xs uppercase text-text-soft-400',
        week: 'mt-1 flex w-full gap-1',
        day: 'group/cell relative size-9 shrink-0 select-none p-0',
        day_button: cn(
          // base
          'flex size-full items-center justify-center rounded-lg text-center text-label-sm text-text-sub-600 outline-none',
          'transition duration-200 ease-out',
          // hover
          'hover:bg-bg-weak-50 hover:text-text-strong-950',
          // focus
          'focus:outline-none focus-visible:bg-bg-weak-50 focus-visible:text-text-strong-950',
          // selected
          'group-aria-selected/cell:bg-primary-base group-aria-selected/cell:text-static-white',
          // disabled
          'disabled:pointer-events-none',
        ),
        today:
          '[&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:left-1/2 [&>button]:after:size-1 [&>button]:after:-translate-x-1/2 [&>button]:after:rounded-full [&>button]:after:bg-primary-base aria-selected:[&>button]:after:bg-static-white',
        outside: '[&>button]:text-text-disabled-300',
        disabled: '[&>button]:text-text-disabled-300',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <IconChevronLeft className="size-5" aria-hidden="true" />
          ) : (
            <IconChevronRight className="size-5" aria-hidden="true" />
          ),
      }}
      {...rest}
    />
  );
}

export { Calendar };
