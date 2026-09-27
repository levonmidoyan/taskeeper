import { IconChecks } from '@tabler/icons-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { projectDot } from '@/components/brand/tint';
import { DueChip } from '@/components/task/DueChip';
import { PriorityChip } from '@/components/task/Priority';
import { auth } from '@/lib/auth';
import { requireWorkspace } from '@/lib/session';
import { listMyOpenTasks } from '@/server/tasks/queries';
import { cn } from '@/utils/cn';

/** Time-of-day greeting in the workspace's zone, so it matches the due dates below it. */
function greeting(timezone: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const [tasks, session] = await Promise.all([
    listMyOpenTasks(ctx),
    auth.api.getSession({ headers: await headers() }),
  ]);
  const firstName = session?.user.name.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: ctx.timezone,
  }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
      <header className="aurora aurora-soft rounded-20 bg-bg-white-0 px-6 py-7 ring-1 ring-inset ring-stroke-soft-200">
        <p className="text-label-sm text-text-sub-600">{today}</p>
        <h1 className="mt-1 text-title-h4 tracking-tight text-text-strong-950">
          {greeting(ctx.timezone)}
          {firstName && (
            <>
              , <span className="bg-linear-to-r from-indigo-600 via-fuchsia-500 to-sky-500 bg-clip-text text-transparent dark:from-indigo-300 dark:via-fuchsia-300 dark:to-sky-300">{firstName}</span>
            </>
          )}
        </h1>
        <p className="mt-2 text-paragraph-sm text-text-sub-600">
          {tasks.length === 0
            ? 'Your plate is clear. Nice.'
            : `You have ${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'} across every project.`}
        </p>
      </header>

      <h2 className="mt-8 text-label-md text-text-strong-950">My tasks</h2>

      {tasks.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-20 border border-dashed border-stroke-sub-300 px-8 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-lighter text-primary-base ring-1 ring-inset ring-primary-alpha-16">
            <IconChecks className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-4 text-label-sm text-text-strong-950">Nothing assigned to you</p>
          <p className="mt-1 text-paragraph-sm text-text-sub-600">
            Open a project from the sidebar to pick up work.
          </p>
        </div>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-20 bg-bg-white-0 shadow-regular-xs ring-1 ring-inset ring-stroke-soft-200">
          {tasks.map((task) => (
            <li key={task.id} className="border-b border-stroke-soft-200 last:border-b-0">
              <Link
                href={`/${workspaceSlug}/tasks/${task.id}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-bg-weak-50"
              >
                <span className="min-w-0 flex-1 truncate text-paragraph-sm text-text-strong-950">
                  {task.title}
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-paragraph-xs text-text-sub-600 sm:inline-flex">
                  <span aria-hidden="true" className={cn('size-1.5 rounded-[2px]', projectDot({ id: task.projectId, color: task.projectColor }))} />
                  {task.projectName}
                </span>
                <PriorityChip priority={task.priority} />
                <DueChip dueDate={task.dueDate} timezone={ctx.timezone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
