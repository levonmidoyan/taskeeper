import { IconCircleCheckFilled, IconClock } from '@tabler/icons-react';
import Link from 'next/link';
import { tintDot } from '@/components/brand/tint';
import { DueChip } from '@/components/task/DueChip';
import { PriorityChip } from '@/components/task/Priority';
import { recencyBucket, type RecencyBucket } from '@/lib/dates';
import { requireWorkspace } from '@/lib/session';
import { listRecentTasks, type RecentTask } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

const BUCKETS: RecencyBucket[] = ['Today', 'Yesterday', 'Past week', 'Older'];

function touchedLabel(at: Date, bucket: RecencyBucket, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    ...(bucket === 'Today' || bucket === 'Yesterday'
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { month: 'short', day: 'numeric' }),
  }).format(at);
}

export default async function RecentPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const tasks = await listRecentTasks(ctx);

  const now = new Date();
  const groups = new Map<RecencyBucket, RecentTask[]>();
  for (const task of tasks) {
    const bucket = recencyBucket(task.touchedAt, ctx.timezone, now);
    groups.set(bucket, [...(groups.get(bucket) ?? []), task]);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
      <h1 className="text-title-h5 text-text-strong-950">Recent</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Tasks you created, changed or commented on lately.
      </p>

      {tasks.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-20 border border-dashed border-stroke-sub-300 px-8 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-lighter text-primary-base ring-1 ring-inset ring-primary-alpha-16">
            <IconClock className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 text-label-sm text-text-strong-950">Nothing here yet</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Tasks you work on will show up here.
          </p>
        </div>
      ) : (
        BUCKETS.filter((b) => groups.has(b)).map((bucket) => (
          <section key={bucket} className="mt-8 first-of-type:mt-6">
            <h2 className="text-label-md text-text-strong-950">{bucket}</h2>
            <ul className="mt-3 overflow-hidden rounded-20 bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200">
              {groups.get(bucket)!.map((task) => (
                <li key={task.id} className="border-b border-stroke-soft-200 last:border-b-0">
                  <Link
                    href={`/${workspaceSlug}/tasks/${task.id}`}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg-weak-50"
                  >
                    {task.completed && (
                      <IconCircleCheckFilled className="size-4 shrink-0 text-success-base" aria-label="Done" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-paragraph-sm',
                        task.completed ? 'text-text-sub-600 line-through' : 'text-text-strong-950',
                      )}
                    >
                      {task.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 text-paragraph-xs text-text-sub-600 sm:inline-flex">
                      <span aria-hidden="true" className={cn('size-1.5 rounded-[2px]', tintDot(task.projectId))} />
                      {task.projectName}
                    </span>
                    <PriorityChip priority={task.priority} />
                    {!task.completed && <DueChip dueDate={task.dueDate} timezone={ctx.timezone} />}
                    <time
                      dateTime={task.touchedAt.toISOString()}
                      className="tabular w-12 shrink-0 text-right text-paragraph-xs text-text-soft-400"
                    >
                      {touchedLabel(task.touchedAt, bucket, ctx.timezone)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
