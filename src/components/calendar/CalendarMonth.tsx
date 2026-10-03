'use client';

import {
  type Active, type Announcements, type CollisionDetection, closestCenter, DndContext, type DragEndEvent,
  KeyboardSensor, MouseSensor, type Over, pointerWithin, TouchSensor, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarChip } from '@/components/calendar/CalendarChip';
import {
  dayLabel, dropTarget, isShownMonth, monthLabel, monthWeeks, shiftMonth, weekdayLabels,
} from '@/components/calendar/month-grid';
import * as Button from '@/components/ui/button';
import * as CompactButton from '@/components/ui/compact-button';
import * as Popover from '@/components/ui/popover';
import { formatDueDate } from '@/lib/dates';
import { settle } from '@/lib/settle';
import type { CalendarTask } from '@/server/tasks/calendar';
import { updateTaskAction } from '@/server/tasks/actions';
import { cn } from '@/utils/cn';

const VISIBLE_PER_DAY = 3;

type Move = { taskId: string; dueDate: string };

// With a pointer only what it is inside counts (released off the grid = no
// drop); the keyboard has no pointer, so the nearest day wins.
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

const chipTitle = (active: Active) => (active.data.current?.title as string | undefined) ?? 'Task';
const overDay = (over: Over | null) => (over ? dayLabel(String(over.id)) : 'no day');

/*
 * dnd-kit's defaults read out raw ids ('droppable area 2026-10-05'). A drop
 * says nothing here: onDragEnd announces it once the save has settled.
 */
const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${chipTitle(active)}.`,
  onDragOver: ({ active, over }) => `${chipTitle(active)} is over ${overDay(over)}.`,
  onDragEnd: () => undefined,
  onDragCancel: ({ active }) => `${chipTitle(active)} was not moved.`,
};

const screenReaderInstructions = {
  draggable: 'To move a task to another day, press Space, then the arrow keys to pick a day, then Space to drop or Escape to cancel. Press Enter to open it.',
};

export function CalendarMonth({
  workspaceSlug,
  month,
  weekStart,
  today,
  tasks,
  taskHref,
  showProject,
}: {
  workspaceSlug: string;
  month: string;
  weekStart: number;
  today: string;
  tasks: CalendarTask[];
  /** 'modal' opens ?task= over this page (project view); 'page' goes to the task's own page. */
  taskHref: 'modal' | 'page';
  showProject: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState('');

  const [optimistic, applyMove] = useOptimistic(tasks, (current: CalendarTask[], move: Move) =>
    current.map((t) => (t.id === move.taskId ? { ...t, dueDate: move.dueDate } : t)),
  );

  const byDay = new Map<string, CalendarTask[]>();
  for (const t of optimistic) byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), t]);

  const weeks = monthWeeks(month, weekStart);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    // Space only, so Enter on a focused chip opens the task instead of lifting it.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Tab'] } }),
  );

  function open(task: CalendarTask) {
    if (taskHref === 'page') {
      router.push(`/${workspaceSlug}/tasks/${task.id}`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    router.push(`?${next.toString()}`, { scroll: false });
  }

  function onDragEnd(event: DragEndEvent) {
    const from = (event.active.data.current?.day as string | undefined) ?? null;
    const to = dropTarget(from, event.over ? String(event.over.id) : null);
    const title = chipTitle(event.active);
    if (!to) {
      setAnnouncement(`${title} was not moved.`);
      return;
    }

    const taskId = String(event.active.id);
    startTransition(async () => {
      applyMove({ taskId, dueDate: to });
      const result = await settle(updateTaskAction(workspaceSlug, { taskId, dueDate: to }));
      // Announced once the save is settled, so a failed move is never read out as done.
      if (result.ok) setAnnouncement(`${title} moved to ${dayLabel(to)}.`);
      else {
        setAnnouncement(`${title} was not moved. ${result.error}`);
        toast.error(result.error);
      }
      // Either way: confirm on success, discard the optimistic move on failure.
      router.refresh();
    });
  }

  const monthHref = (m: string) => `?m=${m}`;
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const inMonth = (day: string) => day.startsWith(month);

  return (
    <section aria-label={`Calendar, ${monthLabel(month)}`} className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-8">
      <div className="flex items-center gap-2 py-3">
        <h2 className="text-label-lg text-text-strong-950">{monthLabel(month)}</h2>
        <div className="ml-auto flex items-center gap-1">
          {isShownMonth(previous) && (
            <CompactButton.Root asChild variant="ghost" size="large">
              <Link href={monthHref(previous)} aria-label="Previous month">
                <CompactButton.Icon as={IconChevronLeft} />
              </Link>
            </CompactButton.Root>
          )}
          <Button.Root asChild size="xsmall" variant="neutral" mode="stroke">
            <Link href={monthHref(today.slice(0, 7))}>Today</Link>
          </Button.Root>
          {isShownMonth(next) && (
            <CompactButton.Root asChild variant="ghost" size="large">
              <Link href={monthHref(next)} aria-label="Next month">
                <CompactButton.Icon as={IconChevronRight} />
              </Link>
            </CompactButton.Root>
          )}
        </div>
      </div>

      <DndContext
        id="calendar"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions }}
      >
        {/* Grid from sm up. A table, not role="grid": there is no arrow-key navigation between days. */}
        <div role="table" aria-label={monthLabel(month)} className="hidden flex-1 flex-col overflow-hidden rounded-2xl ring-1 ring-inset ring-stroke-soft-200 sm:flex">
          <div role="row" className="grid grid-cols-7 border-b border-stroke-soft-200 bg-bg-weak-50">
            {weekdayLabels(weekStart).map((d) => (
              <div key={d} role="columnheader" className="px-2 py-1.5 text-label-xs text-text-sub-600">{d}</div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} role="row" className="grid flex-1 grid-cols-7 border-b border-stroke-soft-200 last:border-b-0">
              {week.map((day) => (
                <DayCell
                  key={day}
                  day={day}
                  today={today}
                  muted={!inMonth(day)}
                  tasks={byDay.get(day) ?? []}
                  showProject={showProject}
                  onOpen={open}
                />
              ))}
            </div>
          ))}
        </div>
      </DndContext>

      {/* Phone: the month's dated tasks as a list. */}
      <ol className="flex flex-col gap-4 sm:hidden">
        {weeks.flat().filter((d) => inMonth(d) && byDay.has(d)).map((day) => (
          <li key={day}>
            <h3 className={cn('mb-1 text-label-sm', day === today ? 'text-primary-base' : 'text-text-sub-600')}>
              {formatDueDate(day, 'UTC', new Date(`${today}T12:00:00Z`))}
            </h3>
            <ul className="flex flex-col gap-1">
              {byDay.get(day)!.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => open(t)} className="w-full truncate rounded-lg px-2 py-1.5 text-left text-paragraph-sm ring-1 ring-inset ring-stroke-soft-200">
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div aria-live="polite" className="sr-only">{announcement}</div>
    </section>
  );
}

function DayCell({
  day, today, muted, tasks, showProject, onOpen,
}: {
  day: string; today: string; muted: boolean; tasks: CalendarTask[]; showProject: boolean;
  onOpen: (task: CalendarTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const visible = tasks.slice(0, VISIBLE_PER_DAY);
  const hidden = tasks.length - visible.length;
  const label = Number(day.slice(8));

  return (
    <div
      ref={setNodeRef}
      role="cell"
      aria-current={day === today ? 'date' : undefined}
      className={cn(
        'flex min-h-24 min-w-0 flex-col gap-1 border-r border-stroke-soft-200 p-1.5 last:border-r-0',
        muted && 'bg-bg-weak-50',
        isOver && 'bg-primary-alpha-10',
      )}
    >
      <span
        className={cn(
          'tabular flex size-6 items-center justify-center rounded-full text-label-xs',
          day === today ? 'bg-primary-base text-static-white' : muted ? 'text-text-soft-400' : 'text-text-sub-600',
        )}
        aria-hidden="true"
      >
        {label}
      </span>
      <span className="sr-only">{dayLabel(day)}</span>
      {visible.map((t) => (
        <CalendarChip key={t.id} task={t} today={today} showProject={showProject} onOpen={onOpen} />
      ))}
      {hidden > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="rounded-md px-1.5 text-left text-label-xs text-text-sub-600 hover:text-text-strong-950">
              +{hidden} more
            </button>
          </Popover.Trigger>
          <Popover.Content align="start" sideOffset={4} showArrow={false} className="flex w-64 flex-col gap-1 p-2">
            {/* Only the hidden ones: dnd-kit needs each draggable id once. */}
            {tasks.slice(VISIBLE_PER_DAY).map((t) => (
              <CalendarChip key={t.id} task={t} today={today} showProject={showProject} onOpen={onOpen} />
            ))}
          </Popover.Content>
        </Popover.Root>
      )}
    </div>
  );
}
